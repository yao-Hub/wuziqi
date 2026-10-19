<template>
  <div class="game">
    <h1>五子棋 - 房间号：{{ roomId }}</h1>
    <div class="info">
      <p>
        你的棋子：{{
          playerColor === "black" ? "黑棋（先手）" : "白棋（后手）"
        }}
      </p>
      <p>当前回合：{{ currentTurn === "black" ? "黑棋" : "白棋" }}</p>
      <p v-if="winner" class="winner">
        获胜方：{{ winner === "black" ? "黑棋" : "白棋" }}
      </p>
      <p class="tip">{{ tip }}</p>
      <p v-if="loading" class="loading">加载房间状态中...</p>
      <!-- 悔棋申请提示 -->
      <p v-if="showRepentRequest" class="repent-request">
        {{ repentRequester }} 申请悔棋，是否同意？
        <button @click="respondRepent(true)" class="btn btn-agree">同意</button>
        <button @click="respondRepent(false)" class="btn btn-refuse">
          拒绝
        </button>
      </p>
    </div>

    <div class="container">
      <!-- 棋盘 -->
      <canvas
        ref="chessBoard"
        width="600"
        height="600"
        @click="handleChessClick"
        :disabled="loading || roomStatus === 'repenting'"
      ></canvas>

      <!-- 操作按钮区 -->
      <div class="action-buttons">
        <!-- 发起悔棋申请：仅当前回合玩家 + 游戏中 + 无申请时可见 -->
        <button
          @click="applyRepent"
          class="btn btn-repent"
          v-if="
            !loading &&
            !winner &&
            !isMyTurn &&
            !showRepentRequest &&
            stepHistory.length > 0 &&
            roomStatus !== 'repenting'
          "
        >
          申请悔棋
        </button>

        <!-- 再来一局：仅游戏结束时可见 -->
        <button
          @click="sendRestart"
          class="btn btn-restart"
          v-if="!loading && winner"
        >
          再来一局
        </button>
      </div>
    </div>

    <button @click="backHome" class="btn">返回首页</button>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import wsManager from "../utils/websocket";

const router = useRouter();
const route = useRoute();
const roomId = route.params.roomId;
const playerColor = route.query.color;
const wsUrl = route.query.wsUrl;

// 状态管理
const chessBoard = ref(null);
const board = ref([]);
const currentTurn = ref("black");
const winner = ref("");
const tip = ref("");
const cellSize = 40;
const loading = ref(true);
const stepHistory = ref([]);
const roomStatus = ref("wating"); // 新增：房间状态（playing/repenting/ended）
const showRepentRequest = ref(false); // 新增：是否显示悔棋申请回应按钮
const repentRequester = ref(""); // 新增：悔棋申请人（黑/白棋）

// 计算属性
const isMyTurn = computed(() => currentTurn.value === playerColor);

const lastStep = computed(() => {
  if (stepHistory.value.length === 0) return null;
  // 返回最后一步落子
  return stepHistory.value[stepHistory.value.length - 1];
});

// 消息处理器 - 基础状态
const handleRoomState = (msg) => {
  board.value = msg.board;
  currentTurn.value = msg.currentTurn;
  stepHistory.value = msg.stepHistory || [];
  roomStatus.value = msg.status || "wating"; // 新增：同步房间状态
  loading.value = false;
  drawBoard();
};

const handleRoomStateFailed = (msg) => {
  tip.value = `加载房间失败：${msg.reason}`;
  loading.value = false;
  setTimeout(() => router.push("/"), 3000);
};

const handleOpponentJoined = (msg) => {
  tip.value = "对手已加入，游戏开始！";
  getRoomState();
};

const handleChessPlaced = (msg) => {
  board.value[msg.x][msg.y] = msg.color;
  currentTurn.value = msg.color === "black" ? "white" : "black";
  stepHistory.value.push({ x: msg.x, y: msg.y, color: msg.color }); // 同步步数
  drawBoard();
  if (msg.isWinner) {
    winner.value = msg.winner;
    roomStatus.value = "ended"; // 标记游戏结束
    tip.value = `${msg.winner === "black" ? "黑棋" : "白棋"}获胜！`;
  }
};

const handlePlaceFailed = (msg) => {
  tip.value = msg.reason;
};

const handleOpponentLeft = (msg) => {
  tip.value = "对手已离开房间";
  winner.value = "";
  currentTurn.value = "black";
  roomStatus.value = "wating";
};

// 消息处理器 - 悔棋相关（核心新增）
const handleRepentApplySuccess = (msg) => {
  tip.value = msg.msg;
  roomStatus.value = "repenting"; // 标记申请中
};

const handleRepentApplyFailed = (msg) => {
  tip.value = `申请悔棋失败：${msg.reason}`;
};

const handleRepentRequestReceived = (msg) => {
  // 收到悔棋申请，显示同意/拒绝按钮
  showRepentRequest.value = true;
  repentRequester.value = msg.requesterColor === "black" ? "黑棋" : "白棋";
  tip.value = `${repentRequester.value}申请悔棋`;
};

const handleRepentAgreed = (msg) => {
  board.value = msg.board;
  currentTurn.value = msg.currentTurn;
  stepHistory.value = msg.stepHistory;
  roomStatus.value = "playing";
  showRepentRequest.value = false;
  tip.value = msg.msg;
  drawBoard();
};

const handleRepentRefused = (msg) => {
  roomStatus.value = "playing";
  tip.value = msg.msg;
};

const handleRepentResponseSuccess = (msg) => {
  showRepentRequest.value = false;
  tip.value = msg.msg;
};

const handleRepentResponseFailed = (msg) => {
  tip.value = `回应悔棋失败：${msg.reason}`;
};

// 消息处理器 - 再来一局
const handleRestartSuccess = (msg) => {
  board.value = msg.board;
  currentTurn.value = msg.currentTurn;
  winner.value = "";
  stepHistory.value = [];
  roomStatus.value = "playing";
  tip.value = "新的一局开始！";
  drawBoard();
};

const handleRestartFailed = (msg) => {
  tip.value = `再来一局失败：${msg.reason}`;
};

// 方法 - 基础逻辑
function getRoomState() {
  try {
    wsManager.send({
      type: "getRoomState",
      roomId,
    });
  } catch (error) {
    tip.value = `请求房间状态失败：${error.message}`;
    loading.value = false;
  }
}

function handleChessClick(e) {
  if (loading.value) {
    tip.value = "房间状态加载中...";
    return;
  }
  if (winner.value) {
    tip.value = "游戏已结束，请重新开始";
    return;
  }
  if (roomStatus.value === "repenting") {
    tip.value = "有未处理的悔棋申请，暂不能落子";
    return;
  }
  if (roomStatus.value === "waiting") {
    tip.value = "请等待对方加入房间";
    return;
  }
  if (!isMyTurn.value) {
    tip.value = "还没到你的回合！";
    return;
  }
  tip.value = "对手回合中...";

  const rect = chessBoard.value.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / cellSize);
  const y = Math.floor((e.clientY - rect.top) / cellSize);

  if (x < 0 || x >= 15 || y < 0 || y >= 15) return;
  if (board.value[x][y] !== null) {
    tip.value = "该位置已有棋子！";
    return;
  }

  try {
    wsManager.send({
      type: "placeChess",
      x,
      y,
      roomId,
    });
  } catch (error) {
    tip.value = error.message;
  }
}

function drawBoard() {
  if (!chessBoard.value || board.value.length === 0) return;

  const ctx = chessBoard.value.getContext("2d");
  ctx.clearRect(0, 0, chessBoard.value.width, chessBoard.value.height);

  // 绘制网格
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  for (let i = 0; i < 15; i++) {
    ctx.beginPath();
    ctx.moveTo(cellSize / 2, cellSize / 2 + i * cellSize);
    ctx.lineTo(cellSize / 2 + 14 * cellSize, cellSize / 2 + i * cellSize);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cellSize / 2 + i * cellSize, cellSize / 2);
    ctx.lineTo(cellSize / 2 + i * cellSize, cellSize / 2 + 14 * cellSize);
    ctx.stroke();
  }

  // 绘制棋子
  for (let x = 0; x < 15; x++) {
    for (let y = 0; y < 15; y++) {
      const color = board.value[x][y];
      if (!color) continue;
      const cx = cellSize / 2 + x * cellSize;
      const cy = cellSize / 2 + y * cellSize;
      ctx.beginPath();
      ctx.arc(cx, cy, cellSize / 2 - 2, 0, Math.PI * 2);
      ctx.fillStyle = color === "black" ? "#000" : "#fff";
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.stroke();
    }
  }

  if (lastStep.value) {
    const { x, y } = lastStep.value;
    const cx = cellSize / 2 + x * cellSize;
    const cy = cellSize / 2 + y * cellSize;

    ctx.beginPath();
    ctx.arc(cx, cy, cellSize / 2 + 3, 0, Math.PI * 2);
    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function sendRestart() {
  try {
    wsManager.send({
      type: "restart",
      roomId,
    });
  } catch (e) {
    tip.value = e.message;
  }
}

function backHome() {
  try {
    wsManager.send({ type: "disconnect", roomId });
  } catch (error) {
    console.warn("发送断开消息失败：", error);
  }
  router.push("/");
}

// 方法 - 悔棋相关（核心新增）
// 发起悔棋申请
function applyRepent() {
  try {
    wsManager.send({
      type: "repentApply",
      roomId,
    });
  } catch (e) {
    tip.value = e.message;
  }
}

// 回应悔棋申请（同意/拒绝）
function respondRepent(agree) {
  try {
    wsManager.send({
      type: "repentResponse",
      roomId,
      agree, // true=同意，false=拒绝
    });
  } catch (e) {
    tip.value = e.message;
  }
}

// 生命周期
onMounted(async () => {
  if (!wsUrl) {
    tip.value = "未获取到服务端连接地址，即将返回首页";
    loading.value = false;
    setTimeout(() => router.push("/"), 3000);
    return;
  }

  try {
    await wsManager.init(wsUrl);

    // 注册所有消息处理器
    wsManager.on("roomState", handleRoomState);
    wsManager.on("roomStateFailed", handleRoomStateFailed);
    wsManager.on("opponentJoined", handleOpponentJoined);
    wsManager.on("chessPlaced", handleChessPlaced);
    wsManager.on("placeFailed", handlePlaceFailed);
    wsManager.on("opponentLeft", handleOpponentLeft);
    // 悔棋相关处理器
    wsManager.on("repentApplySuccess", handleRepentApplySuccess);
    wsManager.on("repentApplyFailed", handleRepentApplyFailed);
    wsManager.on("repentRequestReceived", handleRepentRequestReceived);
    wsManager.on("repentAgreed", handleRepentAgreed);
    wsManager.on("repentRefused", handleRepentRefused);
    wsManager.on("repentResponseSuccess", handleRepentResponseSuccess);
    wsManager.on("repentResponseFailed", handleRepentResponseFailed);
    // 再来一局处理器
    wsManager.on("restartSuccess", handleRestartSuccess);
    wsManager.on("restartFailed", handleRestartFailed);

    getRoomState();
  } catch (error) {
    tip.value = `连接失败：${error.message}，即将返回首页`;
    loading.value = false;
    setTimeout(() => router.push("/"), 3000);
  }
});

onUnmounted(() => {
  // 解绑所有处理器
  wsManager.off("roomState", handleRoomState);
  wsManager.off("roomStateFailed", handleRoomStateFailed);
  wsManager.off("opponentJoined", handleOpponentJoined);
  wsManager.off("chessPlaced", handleChessPlaced);
  wsManager.off("placeFailed", handlePlaceFailed);
  wsManager.off("opponentLeft", handleOpponentLeft);
  wsManager.off("repentApplySuccess", handleRepentApplySuccess);
  wsManager.off("repentApplyFailed", handleRepentApplyFailed);
  wsManager.off("repentRequestReceived", handleRepentRequestReceived);
  wsManager.off("repentAgreed", handleRepentAgreed);
  wsManager.off("repentRefused", handleRepentRefused);
  wsManager.off("repentResponseSuccess", handleRepentResponseSuccess);
  wsManager.off("repentResponseFailed", handleRepentResponseFailed);
  wsManager.off("restartSuccess", handleRestartSuccess);
  wsManager.off("restartFailed", handleRestartFailed);

  wsManager.send({ type: "disconnect", roomId });
});
</script>

<style scoped>
.game {
  max-width: 650px;
  margin: 20px auto;
  text-align: center;
}
.info {
  margin: 10px 0;
  height: 100px;
}
.winner {
  color: #e63946;
  font-size: 18px;
  font-weight: bold;
}
.tip {
  color: #e63946;
}
.loading {
  color: #42b983;
}
canvas {
  border: 2px solid #000;
  margin: 20px 0;
  cursor: pointer;
}
canvas:disabled {
  cursor: not-allowed;
  opacity: 0.8;
}
.btn {
  padding: 8px 16px;
  cursor: pointer;
  color: white;
  border: none;
  border-radius: 4px;
  margin: 0 5px;
}
.btn-agree {
  background: #42b983;
}
.btn-refuse {
  background: #e63946;
}
.btn-repent {
  background: #ff9800;
}
.btn-restart {
  background: #2196f3;
}
.container {
  display: flex;
}
.action-buttons {
  margin: 80px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 60px;
  min-width: 150px;
}
.repent-request {
  color: #ff9800;
  font-weight: bold;
  margin: 10px 0;
}
</style>

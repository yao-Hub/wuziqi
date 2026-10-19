<template>
  <div class="home">
    <h1>五子棋联机游戏</h1>

    <!-- 服务端连接配置 -->
    <div class="server-config">
      <h3>服务端配置</h3>
      <input
        v-model="serverIp"
        type="text"
        placeholder="输入服务端IP(例如 192.168.10.12:9000)"
      />
      <button @click="connectServer" class="btn">连接服务端</button>
      <p v-if="wsUrl" class="success">已获取连接地址：{{ wsUrl }}</p>
    </div>

    <!-- 创建房间 -->
    <button @click="createRoom" class="btn" :disabled="!wsUrl">
      创建新房间
    </button>

    <!-- 房间列表 -->
    <div class="room-list">
      <h3>可用房间</h3>
      <button @click="getRoomList" class="btn" :disabled="!wsUrl">
        刷新房间列表
      </button>
      <ul v-if="roomList.length > 0">
        <li v-for="room in roomList" :key="room.id">
          房间号：{{ room.id }}（{{ room.playerCount }}/2人）
          <button @click="joinRoom(room.id)" class="btn" :disabled="!wsUrl">
            加入
          </button>
        </li>
      </ul>
      <p v-else>暂无可用房间</p>
    </div>

    <!-- 搜索房间号加入 -->
    <div class="join-by-id">
      <h3>通过房间号加入</h3>
      <input
        v-model="searchRoomId"
        type="text"
        placeholder="输入4位房间号"
        maxlength="4"
      />
      <button
        @click="joinRoom(searchRoomId)"
        class="btn"
        :disabled="!wsUrl || !searchRoomId"
      >
        加入房间
      </button>
    </div>

    <!-- 提示信息 -->
    <p class="tip" v-if="tip">{{ tip }}</p>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import wsManager from "../utils/websocket"; // 引入全局WebSocket

const router = useRouter();
const roomList = ref([]);
const searchRoomId = ref("");
const tip = ref("");
const serverIp = ref("192.168.10.12:9000");
const wsUrl = ref("");

// 消息处理器函数（需保存引用，用于解绑）
const handleRoomCreated = (msg) => {
  tip.value = `房间创建成功，房间号：${msg.roomId}，你是黑棋（先手）`;
  router.push({
    name: "Game",
    params: { roomId: msg.roomId },
    query: { color: msg.color, wsUrl: wsUrl.value },
  });
};

const handleRoomList = (msg) => {
  roomList.value = msg.list;
};

const handleJoinFailed = (msg) => {
  tip.value = `加入失败：${msg.reason}`;
};

const handleRoomJoined = (msg) => {
  tip.value = `加入房间成功，你是白棋（后手）`;
  router.push({
    name: "Game",
    params: { roomId: msg.roomId },
    query: {
      color: msg.color,
      wsUrl: wsUrl.value,
    },
  });
};

// 连接服务端
async function connectServer() {
  try {
    const response = await fetch(`http://${serverIp.value}/ip`);
    if (!response.ok) throw new Error("服务端连接失败");

    const data = await response.json();
    wsUrl.value = data.wsUrl;
    tip.value = "";

    // 初始化全局WebSocket
    await wsManager.init(wsUrl.value);

    // 注册Home页需要的消息处理器
    wsManager.on("roomCreated", handleRoomCreated);
    wsManager.on("roomList", handleRoomList);
    wsManager.on("joinFailed", handleJoinFailed);
    wsManager.on("roomJoined", handleRoomJoined);

    // 初始化获取房间列表
    getRoomList();
  } catch (error) {
    tip.value = `连接服务端失败：${error.message}，请检查IP是否正确`;
    wsUrl.value = "";
  }
}

// 创建房间
function createRoom() {
  try {
    wsManager.send({ type: "createRoom" });
  } catch (error) {
    tip.value = error.message;
  }
}

// 获取房间列表
function getRoomList() {
  try {
    wsManager.send({ type: "getRoomList" });
  } catch (error) {
    tip.value = error.message;
  }
}

// 加入房间
function joinRoom(roomId) {
  if (!roomId) {
    tip.value = "请输入房间号";
    return;
  }
  try {
    wsManager.send({ type: "joinRoom", roomId });
  } catch (error) {
    tip.value = error.message;
  }
}

// 页面卸载时解绑消息处理器（避免内存泄漏）
onUnmounted(() => {
  wsManager.off("roomCreated", handleRoomCreated);
  wsManager.off("roomList", handleRoomList);
  wsManager.off("joinFailed", handleJoinFailed);
  wsManager.off("roomJoined", handleRoomJoined);
});

onMounted(() => {
  connectServer();
});
</script>

<style scoped>
/* 样式保持不变，省略 */
.home {
  max-width: 600px;
  margin: 50px auto;
  text-align: center;
}
.btn {
  margin: 5px;
  padding: 8px 16px;
  cursor: pointer;
  background: #42b983;
  color: white;
  border: none;
  border-radius: 4px;
}
.btn:disabled {
  background: #999;
  cursor: not-allowed;
}
.btn:hover:not(:disabled) {
  background: #359469;
}
.server-config,
.room-list,
.join-by-id {
  margin: 30px 0;
  padding: 20px;
  border: 1px solid #eee;
  border-radius: 8px;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  margin: 10px 0;
  padding: 10px;
  background: #f5f5f5;
  border-radius: 4px;
  color: #000;
}
input {
  padding: 8px;
  width: 200px;
  margin-right: 10px;
}
.tip {
  color: #e63946;
  margin-top: 20px;
}
.success {
  color: #42b983;
  margin-top: 10px;
}
</style>

const WebSocket = require('ws');
const http = require('http');
const os = require('os');
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// 启动服务（端口3000）
const PORT = 9000;
// 获取本机局域网IP的函数
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const ipList = [];

  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        ipList.push(alias.address);
      }
    }
  }

  return ipList.length > 0 ? ipList[0] : '127.0.0.1';
}

// 新增：处理HTTP请求（IP查询接口）
server.on('request', (req, res) => {
  // 设置跨域头，允许客户端请求
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');

  // 处理/ip接口请求
  if (req.url === '/ip') {
    const localIP = getLocalIP();
    res.end(JSON.stringify({
      ip: localIP,
      port: PORT,
      wsUrl: `ws://${localIP}:${PORT}`
    }));
    return;
  }

  // 其他接口返回404
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

// 以下是原有代码（房间管理、胜负判断、WebSocket处理）保持不变
// 房间列表：key=房间号，value=房间信息
const rooms = {};
// 生成随机4位房间号
function generateRoomId() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// 胜负判断：检测指定位置是否形成五子连珠
function checkWinner(board, x, y, color) {
  const directions = [
    [0, 1],  // 横向
    [1, 0],  // 纵向
    [1, 1],  // 右下斜向
    [1, -1]  // 右上斜向
  ];

  for (const [dx, dy] of directions) {
    let count = 1;
    // 正向检测
    for (let i = 1; i < 5; i++) {
      const nx = x + dx * i;
      const ny = y + dy * i;
      if (nx >= 0 && nx < 15 && ny >= 0 && ny < 15 && board[nx][ny] === color) {
        count++;
      } else {
        break;
      }
    }
    // 反向检测
    for (let i = 1; i < 5; i++) {
      const nx = x - dx * i;
      const ny = y - dy * i;
      if (nx >= 0 && nx < 15 && ny >= 0 && ny < 15 && board[nx][ny] === color) {
        count++;
      } else {
        break;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

// 处理WebSocket连接
wss.on('connection', (ws) => {
  let currentRoom = null; // 当前玩家所在房间
  let playerColor = null; // 玩家棋子颜色（黑/白）

  // 监听客户端消息
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case 'getRoomState': {
        const { roomId } = msg;
        const room = rooms[roomId];
        if (!room) {
          ws.send(JSON.stringify({
            type: 'roomStateFailed',
            reason: '房间不存在'
          }));
          return;
        }
        // 返回房间实时状态（board、当前回合、游戏状态）
        ws.send(JSON.stringify({
          type: 'roomState',
          board: room.board,
          currentTurn: room.currentTurn,
          status: room.status,
          winner: null // 若已结束可返回winner
        }));
        break;
      }
      // 创建房间
      case 'createRoom': {
        const roomId = generateRoomId();
        // 初始化房间：15x15棋盘（空值为null）、玩家列表、当前回合（黑棋先下）
        rooms[roomId] = {
          id: roomId,
          players: [ws],
          board: Array(15).fill().map(() => Array(15).fill(null)),
          currentTurn: 'black',
          status: 'waiting', // waiting/playing/ended
          stepHistory: [],   // 新增：落子历史 [ {x,y,color}, ... ]
          winner: null       // 新增：胜者
        };
        currentRoom = roomId;
        playerColor = 'black'; // 创建者为黑棋
        // 回复创建成功
        ws.send(JSON.stringify({
          type: 'roomCreated',
          roomId,
          color: playerColor
        }));
        break;
      }

      // 获取房间列表
      case 'getRoomList': {
        const roomList = Object.values(rooms).filter(room => room.status === 'waiting').map(room => ({
          id: room.id,
          playerCount: room.players.length
        }));
        ws.send(JSON.stringify({
          type: 'roomList',
          list: roomList
        }));
        break;
      }

      // 加入房间（通过房间号）
      case 'joinRoom': {
        const { roomId } = msg;
        const room = rooms[roomId];
        if (!room) {
          ws.send(JSON.stringify({ type: 'joinFailed', reason: '房间不存在' }));
          return;
        }
        if (room.players.length >= 2) {
          ws.send(JSON.stringify({ type: 'joinFailed', reason: '房间已满' }));
          return;
        }
        // 加入房间
        room.players.push(ws);
        room.status = 'playing';
        currentRoom = roomId;
        playerColor = 'white'; // 加入者为白棋
        // 通知自己加入成功
        ws.send(JSON.stringify({
          type: 'roomJoined',
          roomId,
          color: playerColor,
          board: room.board
        }));
        // 通知房间内另一个玩家：对手已加入
        room.players[0].send(JSON.stringify({
          type: 'opponentJoined',
          color: 'white',
          board: room.board
        }));
        break;
      }

      // 落子操作
      case 'placeChess': {
        const { x, y } = msg;
        const room = rooms[currentRoom];
        if (!room) return;
        if (room.status === 'repenting') {
          ws.send(JSON.stringify({ type: 'placeFailed', reason: '有未处理的悔棋申请，暂不能落子' }));
          return;
        }
        // 校验：是否是当前玩家回合、位置是否为空
        if (room.currentTurn !== playerColor) {
          ws.send(JSON.stringify({ type: 'placeFailed', reason: '不是你的回合' }));
          return;
        }
        if (room.board[x][y] !== null) {
          ws.send(JSON.stringify({ type: 'placeFailed', reason: '该位置已有棋子' }));
          return;
        }

        // 落子
        room.board[x][y] = playerColor;
        // 记录步数
        room.stepHistory.push({ x, y, color: playerColor });
        // 检测胜负
        const isWinner = checkWinner(room.board, x, y, playerColor);
        // 广播落子信息给房间内所有玩家
        room.players.forEach(player => {
          player.send(JSON.stringify({
            type: 'chessPlaced',
            x, y, color: playerColor,
            isWinner,
            winner: isWinner ? playerColor : null,
            stepHistory: room.stepHistory,
          }));
        });

        // 更新回合/游戏状态
        if (isWinner) {
          room.status = 'ended';
          room.winner = playerColor;
        } else {
          room.currentTurn = room.currentTurn === 'black' ? 'white' : 'black';
        }
        break;
      }

      // 1. 发起悔棋申请
      case 'repentApply': {
        const room = rooms[currentRoom];
        // 校验条件：游戏中 + 无待处理申请 + 当前回合玩家发起
        if (!room || room.status !== 'playing' || room.repentRequest || room.currentTurn === playerColor) {
          ws.send(JSON.stringify({
            type: 'repentApplyFailed',
            reason: room.status !== 'playing' ? '游戏未进行中' :
              room.repentRequest ? '已有待处理的悔棋申请' : '非当前回合，无法发起悔棋'
          }));
          return;
        }
        // 校验：有落子历史才能悔棋
        if (room.stepHistory.length === 0) {
          ws.send(JSON.stringify({ type: 'repentApplyFailed', reason: '暂无落子，无法悔棋' }));
          return;
        }

        // 记录悔棋申请（标记房间为悔棋申请中）
        const lastStep = room.stepHistory[room.stepHistory.length - 1];
        room.status = 'repenting'; // 锁定房间，禁止落子
        room.repentRequest = {
          requester: ws,        // 申请人
          requesterColor: playerColor, // 申请人颜色（当前回合玩家）
          step: lastStep        // 要悔的步数（上一步）
        };

        // 通知申请人：申请已发送
        ws.send(JSON.stringify({ type: 'repentApplySuccess', msg: '已向对方发送悔棋申请' }));

        // 通知对方：收到悔棋申请
        room.players.forEach(p => {
          if (p !== ws) { // 只通知对方
            p.send(JSON.stringify({
              type: 'repentRequestReceived',
              requesterColor: playerColor // 谁发起的申请（黑/白棋）
            }));
          }
        });
        break;
      }

      // 2. 回应悔棋申请（同意/拒绝）
      case 'repentResponse': {
        const { agree } = msg;
        const room = rooms[currentRoom];
        // 校验条件：有待处理申请 + 回应者是被申请人
        if (!room || !room.repentRequest || room.status !== 'repenting' || room.repentRequest.requester === ws) {
          ws.send(JSON.stringify({ type: 'repentResponseFailed', reason: '无待处理的悔棋申请' }));
          return;
        }

        const request = room.repentRequest;
        // 重置悔棋申请状态
        room.status = 'playing';
        room.repentRequest = null;

        if (agree) {
          // 同意悔棋：回退最后一步
          room.board[request.step.x][request.step.y] = null;
          room.stepHistory.pop(); // 删除最后一步
          room.currentTurn = request.step.color; // 回合回退到被悔的那一步（比如黑棋下完，白棋申请悔棋，同意后回合回到黑棋）

          // 广播：悔棋成功
          room.players.forEach(p => {
            p.send(JSON.stringify({
              type: 'repentAgreed',
              board: room.board,
              currentTurn: room.currentTurn,
              stepHistory: room.stepHistory,
              msg: '对方同意悔棋，已回退上一步'
            }));
          });
        } else {
          // 拒绝悔棋：通知双方
          room.players.forEach(p => {
            if (p === request.requester) {
              p.send(JSON.stringify({ type: 'repentRefused', msg: '对方拒绝了你的悔棋申请' }));
            } else {
              p.send(JSON.stringify({ type: 'repentResponseSuccess', msg: '你已拒绝悔棋申请' }));
            }
          });
        }
        break;
      }

      // 新增：再来一局
      case 'restart': {
        const room = rooms[currentRoom];
        if (!room || room.status !== 'ended') {
          ws.send(JSON.stringify({ type: 'restartFailed', reason: '游戏未结束' }));
          return;
        }

        // 重置整个房间状态
        room.board = Array(15).fill().map(() => Array(15).fill(null));
        room.currentTurn = 'black';
        room.status = 'playing';
        room.stepHistory = [];
        room.winner = null;
        room.repentRequest = null;
        room.players.forEach(p => {
          p.send(JSON.stringify({
            type: 'restartSuccess',
            board: room.board,
            currentTurn: room.currentTurn
          }));
        });
        break;
      }

      // 断开连接：清理房间
      case 'disconnect': {
        if (currentRoom && rooms[currentRoom]) {
          const room = rooms[currentRoom];
          room.players = room.players.filter(p => p !== ws);
          // 房间无玩家则删除
          if (room.players.length === 0) {
            delete rooms[currentRoom];
          } else {
            // 通知剩余玩家：对手离开
            room.players.forEach(p => {
              p.send(JSON.stringify({ type: 'opponentLeft' }));
            });
            room.status = 'waiting';
          }
        }
        break;
      }
    }
  });

  // 监听连接关闭
  ws.on('close', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      room.players = room.players.filter(p => p !== ws);
      if (room.players.length === 0) {
        delete rooms[currentRoom];
      } else {
        room.players.forEach(p => {
          p.send(JSON.stringify({ type: 'opponentLeft' }));
        });
        room.status = 'waiting';
      }
    }
  });
});

const localIP = getLocalIP();
server.listen(PORT, () => {
  console.log('=====================================');
  console.log('五子棋服务已启动！');
  console.log(`局域网IP: ${localIP}`);
  console.log(`HTTP接口地址: http://${localIP}:${PORT}/ip`);
  console.log(`WebSocket连接地址: ws://${localIP}:${PORT}`);
  console.log('=====================================');
});
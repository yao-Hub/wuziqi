// 全局单例WebSocket管理
class WebSocketManager {
  constructor() {
    this.ws = null; // WebSocket实例
    this.wsUrl = ''; // 连接地址
    this.messageHandlers = new Map(); // 消息处理器映射：type => [callback]
    this.isConnected = false; // 连接状态
  }

  // 初始化连接（单例：已连接则直接返回）
  init(wsUrl) {
    if (this.isConnected && this.wsUrl === wsUrl) {
      return Promise.resolve();
    }

    // 关闭旧连接
    if (this.ws) {
      this.ws.close();
    }

    this.wsUrl = wsUrl;
    this.isConnected = false;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      // 连接成功
      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('全局WebSocket连接成功');
        resolve();
      };

      // 连接失败
      this.ws.onerror = (error) => {
        this.isConnected = false;
        reject(error);
      };

      // 连接关闭
      this.ws.onclose = () => {
        this.isConnected = false;
        console.log('全局WebSocket连接关闭');
        // 清空所有处理器
        this.messageHandlers.clear();
      };

      // 统一处理消息分发
      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const handlers = this.messageHandlers.get(msg.type) || [];
          // 执行所有该类型的消息处理器
          handlers.forEach(handler => handler(msg));
        } catch (error) {
          console.error('消息解析失败：', error);
        }
      };
    });
  }

  // 发送消息（确保连接状态）
  send(data) {
    if (!this.isConnected) {
      throw new Error('WebSocket未连接');
    }
    this.ws.send(JSON.stringify(data));
  }

  // 注册消息处理器（支持多个回调）
  on(type, callback) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type).push(callback);
  }

  // 移除指定类型的指定处理器
  off(type, callback) {
    if (!this.messageHandlers.has(type)) return;
    const handlers = this.messageHandlers.get(type);
    const index = handlers.indexOf(callback);
    if (index > -1) {
      handlers.splice(index, 1);
    }
    // 无处理器时清空该类型
    if (handlers.length === 0) {
      this.messageHandlers.delete(type);
    }
  }

  // 移除指定类型的所有处理器
  offAll(type) {
    this.messageHandlers.delete(type);
  }

  // 关闭连接
  close() {
    if (this.ws) {
      this.ws.close();
    }
    this.isConnected = false;
    this.messageHandlers.clear();
  }
}

// 导出单例实例
export default new WebSocketManager();
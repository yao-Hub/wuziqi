<template>
  <router-view />
</template>

<script setup>
import { onUnmounted } from "vue";
import wsManager from "./utils/websocket";

// 应用卸载时关闭WebSocket连接
onUnmounted(() => {
  wsManager.close();
});
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: Arial, sans-serif;
}
</style>

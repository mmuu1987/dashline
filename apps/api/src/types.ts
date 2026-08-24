/** 存储层共享行类型（避免 store ↔ 路由循环依赖） */

export interface StoredRun {
  playerId: string;
  nickname: string;
  score: number;
  timeMs: number;
  coins: number;
  distanceM: number;
  finished: boolean;
  inputsB64: string;
  attemptNo: number;
  clientVersion: string;
  at: number;
}

export interface GhostOfferRow {
  nickname: string;
  timeMs: number;
  score: number;
  inputsB64: string;
}

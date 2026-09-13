/** 渲染层共享常量 */
export const VIEW_W = 960;
export const VIEW_H = 540;

/**
 * 全局像素素材缩放：Sunny Land 素材按 384×216 绘制，视口 960×540 正好是它的 2.5 倍。
 * 所有 16px 素材格都必须用这一个系数（地面、道具、宝石、装饰），
 * 混用不同倍率会让同一画面出现多种像素密度，看起来"糊"且比例失调。
 */
export const ART_SCALE = 2.5;

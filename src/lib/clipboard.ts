// 剪贴板写入（优先 Tauri 插件，降级 navigator.clipboard）。
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);

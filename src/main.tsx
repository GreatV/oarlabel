import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// The app provides contextual actions itself; suppress the WebView/browser
// menu everywhere, including canvas blank space and non-interactive panels.
document.addEventListener("contextmenu", (event) => event.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

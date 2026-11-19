import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { DataProvider } from "./app/data";
import { ToastProvider } from "./ui/Toast";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <DataProvider>
        <App />
      </DataProvider>
    </ToastProvider>
  </StrictMode>,
);

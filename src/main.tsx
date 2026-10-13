import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@xyflow/react/dist/style.css";
import "./app/styles/tokens.css";
import "./app/styles/base.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { installDevelopmentHooks } from "./app/developmentHooks";

installDevelopmentHooks();

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error('index.html must contain an element with id "root".');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

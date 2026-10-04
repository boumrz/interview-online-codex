import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { store } from "./app/store";
import { App } from "./app/App";
import { ThemeProvider } from "./features/theme/ThemeProvider";
import { initAnalytics } from "./services/analytics";
import "antd/dist/reset.css";
import "highlight.js/styles/github-dark.css";
import "./styles/global.css";

initAnalytics();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemeProvider>
        <BrowserRouter useTransitions={false}>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </Provider>
  </React.StrictMode>
);

import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { store } from "./app/store";
import { App } from "./app/App";
import { initAnalytics } from "./services/analytics";
import "@mantine/core/styles.css";
import "./styles/global.css";

initAnalytics();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <MantineProvider
        forceColorScheme="dark"
        theme={{
          primaryColor: "gray",
          fontFamily: "IBM Plex Sans, Segoe UI, sans-serif",
          defaultRadius: "md",
          headings: {
            fontFamily: "IBM Plex Sans, Segoe UI, sans-serif"
          },
          components: {
            // Глобальная стилизация тултипов под платформенную dark-тему,
            // чтобы белый Mantine-default не выбивался.
            Tooltip: {
              defaultProps: {
                withinPortal: true,
                offset: 8,
                radius: "md",
                withArrow: true,
                transitionProps: { transition: "fade", duration: 90 }
              },
              styles: {
                tooltip: {
                  backgroundColor: "#11161f",
                  color: "#d6dce6",
                  border: "1px solid #273242",
                  boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)",
                  fontSize: 12,
                  fontWeight: 500,
                  padding: "6px 10px",
                  letterSpacing: 0.1
                },
                arrow: {
                  backgroundColor: "#11161f",
                  borderColor: "#273242"
                }
              }
            }
          }
        }}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MantineProvider>
    </Provider>
  </React.StrictMode>
);

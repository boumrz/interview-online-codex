import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { store } from "./app/store";
import { App } from "./app/App";
import "@mantine/core/styles.css";
import "./styles/global.css";

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

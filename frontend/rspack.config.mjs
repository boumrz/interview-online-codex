import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import path from "node:path";

const isBuildCommand = process.argv.includes("build");
const isProduction = isBuildCommand;

export default defineConfig({
  mode: isProduction ? "production" : "development",
  // Infrastructure request URLs can contain private SSE query values; compilation stats stay visible.
  infrastructureLogging: { level: "none" },
  // Compile imported screens before serving them so the first room/PDF load does not wait for a dev proxy reload.
  lazyCompilation: false,
  entry: "./src/main.tsx",
  devtool: isProduction ? false : "cheap-module-source-map",
  output: {
    path: path.resolve(process.cwd(), "dist"),
    publicPath: "/",
    clean: true,
    filename: isProduction ? "[name].[contenthash:8].js" : "[name].js",
    chunkFilename: isProduction ? "[name].[contenthash:8].chunk.js" : "[name].chunk.js"
  },
  devServer: {
    port: 5173,
    // SSE must stay uncompressed in dev; gzip buffering prevents EventSource from receiving updates promptly.
    compress: false,
    historyApiFallback: true,
    // Keep source assets from being embedded by another origin on plain HTTP.
    headers: { "Cross-Origin-Resource-Policy": "same-origin" },
    setupMiddlewares(middlewares) {
      // These local actions are unused by the app and accept unsafe cross-site GETs upstream.
      const safeMiddlewares = middlewares.filter(({ name }) => (
        name !== "rspack-dev-server-open-editor" && name !== "rspack-dev-server-invalidate"
      ));
      safeMiddlewares.unshift({
        name: "deny-dev-server-actions",
        middleware(req, res, next) {
          let pathname;
          try {
            pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
          } catch {
            res.statusCode = 400;
            res.end("Invalid request path");
            return;
          }
          if (/^\/(?:rspack|webpack)-dev-server\/(?:open-editor|invalidate)(?:\/|$)/i.test(pathname)) {
            res.statusCode = 403;
            res.end("Development server action disabled");
            return;
          }
          next();
        }
      });
      return safeMiddlewares;
    },
    proxy: [
      {
        pathFilter: ["/api"],
        target: process.env.DEV_API_PROXY_TARGET ?? "http://localhost:8080",
        changeOrigin: true,
        on: {
          proxyReq(proxyReq, req, res) {
            if (!/^\/api\/realtime\/rooms\/[^/]+\/stream(?:\?|$)/.test(req.url ?? "")) return;
            res.once("close", () => proxyReq.destroy());
          }
        }
      }
    ]
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    alias: {
      components: path.resolve(process.cwd(), "src/components")
    }
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "builtin:swc-loader",
        type: "javascript/auto"
      },
      {
        test: /\.css$/,
        oneOf: [
          {
            test: /\.module\.css$/,
            use: [
              rspack.CssExtractRspackPlugin.loader,
              {
                loader: "css-loader",
                options: {
                  modules: {
                    namedExport: false
                  }
                }
              }
            ]
          },
          {
            use: [rspack.CssExtractRspackPlugin.loader, "css-loader"]
          }
        ]
      }
    ]
  },
  optimization: isProduction
    ? {
      splitChunks: {
        chunks: "all"
      },
      runtimeChunk: "single"
    }
    : undefined,
  plugins: [
    new rspack.DefinePlugin({
      __FEATURE_AGENT_OPS__: JSON.stringify(process.env.FEATURE_AGENT_OPS ?? "false"),
      "process.env.FEATURE_AGENT_OPS": JSON.stringify(process.env.FEATURE_AGENT_OPS ?? "false"),
      "process.env.FEATURE_TEAM_MERGE_COMMIT": JSON.stringify(process.env.FEATURE_TEAM_MERGE_COMMIT ?? "false"),
      "process.env.VITE_API_BASE_URL": JSON.stringify(process.env.VITE_API_BASE_URL ?? "/api"),
      "process.env.VITE_LEGACY_PUBLIC_DOMAIN": JSON.stringify(
        process.env.VITE_LEGACY_PUBLIC_DOMAIN ?? "interview.domiknote.ru"
      ),
      "process.env.VITE_NEW_PUBLIC_DOMAIN": JSON.stringify(
        process.env.VITE_NEW_PUBLIC_DOMAIN ?? "interview.vtools.tech"
      ),
      "process.env.VITE_LEGACY_DOMAIN_SHUTDOWN_DATE": JSON.stringify(
        process.env.VITE_LEGACY_DOMAIN_SHUTDOWN_DATE ?? "2026-07-26"
      ),
      "process.env.VITE_SHOW_LEGACY_DOMAIN_NOTICE": JSON.stringify(
        process.env.VITE_SHOW_LEGACY_DOMAIN_NOTICE ?? "false"
      ),
      "process.env.VITE_METRIKA_ALLOWED_HOSTS": JSON.stringify(
        process.env.VITE_METRIKA_ALLOWED_HOSTS ?? "interview.vtools.tech,interview.domiknote.ru"
      )
    }),
    new rspack.HtmlRspackPlugin({
      template: "./public/index.html"
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: path.resolve(process.cwd(), "public"),
          to: path.resolve(process.cwd(), "dist"),
          globOptions: {
            ignore: ["**/index.html"]
          }
        }
      ]
    }),
    new rspack.CssExtractRspackPlugin(
      isProduction
        ? {
          filename: "[name].[contenthash:8].css",
          chunkFilename: "[name].[contenthash:8].chunk.css"
        }
        : {}
    )
  ]
});

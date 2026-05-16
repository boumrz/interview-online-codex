import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import path from "node:path";

const isBuildCommand = process.argv.includes("build");
const isProduction = isBuildCommand;

export default defineConfig({
  mode: isProduction ? "production" : "development",
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
    proxy: [
      {
        context: ["/api"],
        target: process.env.DEV_API_PROXY_TARGET ?? "http://localhost:8080",
        changeOrigin: true
      }
    ]
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"]
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
      "process.env.VITE_API_BASE_URL": JSON.stringify(process.env.VITE_API_BASE_URL ?? "/api"),
      "process.env.VITE_METRIKA_ALLOWED_HOSTS": JSON.stringify(
        process.env.VITE_METRIKA_ALLOWED_HOSTS ?? "interview.domiknote.ru"
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

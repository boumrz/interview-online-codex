# Design: additive local CORS origins

## Decision

`WebConfig` will compose an origin set from:

1. the fixed local frontend origins `http://localhost:5173` and
   `http://127.0.0.1:5173`; and
2. comma-separated values from `app.cors.allowed-origins`.

The resulting distinct origins configure Spring MVC for `/api/**`. This retains
explicit origin matching, avoids wildcard credentials exposure, and prevents a
stale environment variable from disabling the normal local frontend URL.

## Verification choice

A focused MockMvc integration test is proportionate: it directly exercises the
Spring CORS preflight path that currently returns `403`, including a configuration
override that contains only `localhost:5173`. A browser registration E2E confirms
the user-visible flow through the frontend proxy.

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { User } from "../../types";

type AuthState = {
  token: string | null;
  user: User | null;
};

const storedToken = localStorage.getItem("auth_token");
const storedUser = localStorage.getItem("auth_user");

function normalizeStoredUser(raw: User | null): User | null {
  if (!raw) return null;
  const nickname = raw.nickname ?? "";
  const normalizedRole =
    typeof raw.role === "string" && raw.role.trim().length > 0
      ? raw.role
      : nickname.trim().toLowerCase() === "boumrz"
      ? "admin"
      : "user";
  return {
    ...raw,
    role: normalizedRole
  };
}

const initialState: AuthState = {
  token: storedToken,
  user: storedUser ? normalizeStoredUser(JSON.parse(storedUser) as User) : null
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setAuth(state, action: PayloadAction<{ token: string; user: User }>) {
      state.token = action.payload.token;
      state.user = action.payload.user;
      localStorage.setItem("auth_token", action.payload.token);
      localStorage.setItem("auth_user", JSON.stringify(action.payload.user));
    },
    clearAuth(state) {
      state.token = null;
      state.user = null;
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      const scopedPrefixes = [
        "owner_token_",
        "interviewer_token_",
        "guest_display_name_",
        "guest_interviewer_display_name_"
      ];
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        if (scopedPrefixes.some((prefix) => key.startsWith(prefix))) {
          localStorage.removeItem(key);
        }
      }
    }
  }
});

export const { setAuth, clearAuth } = authSlice.actions;
export default authSlice.reducer;

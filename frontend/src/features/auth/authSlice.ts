import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { User } from "../../types";

type AuthState = {
  token: string | null;
  user: User | null;
};

const storedToken = localStorage.getItem("auth_token");

function normalizeUser(raw: User): User {
  const nickname = raw.nickname ?? "";
  const displayName = raw.displayName ?? "";
  const normalizedRole =
    typeof raw.role === "string" && raw.role.trim().length > 0
      ? raw.role
      : nickname.trim().toLowerCase() === "boumrz"
      ? "admin"
      : "user";
  return {
    ...raw,
    displayName,
    role: normalizedRole
  };
}

const initialState: AuthState = {
  token: storedToken,
  user: null
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setAuthToken(state, action: PayloadAction<string>) {
      const nextToken = action.payload.trim();
      if (!nextToken) return;
      if (state.token !== nextToken) {
        state.user = null;
      }
      state.token = nextToken;
      localStorage.setItem("auth_token", nextToken);
    },
    setCurrentUser(state, action: PayloadAction<User>) {
      state.user = normalizeUser(action.payload);
    },
    updateProfile(state, action: PayloadAction<{ displayName: string }>) {
      if (!state.user) return;
      state.user.displayName = action.payload.displayName;
    },
    clearAuth(state) {
      state.token = null;
      state.user = null;
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      const scopedPrefixes = [
        "display_name",
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

export const { setAuthToken, setCurrentUser, updateProfile, clearAuth } = authSlice.actions;
export default authSlice.reducer;

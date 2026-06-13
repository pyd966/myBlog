export const config = {
  port: Number(process.env.PORT || 3000),
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  sessionSecret: process.env.SESSION_SECRET || "dev-secret",
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || ""
  },
  ai: {
    apiKey: process.env.AI_API_KEY || "",
    baseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.AI_MODEL || "gpt-4o-mini"
  }
};

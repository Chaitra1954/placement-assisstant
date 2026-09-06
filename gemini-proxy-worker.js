// Cloudflare Worker: proxies requests to Gemini so the API key never reaches the browser.
//
// SETUP:
// 1. Go to https://dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker
// 2. Paste this entire file as the worker's code.
// 3. Go to Settings -> Variables -> add an Environment Variable:
//      Name: GEMINI_API_KEY
//      Value: <your real Gemini API key>
//      Click "Encrypt" so it's stored as a secret.
// 4. Deploy. Copy the worker URL (looks like https://gemini-proxy.<yourname>.workers.dev)
// 5. Paste that URL into GEMINI_PROXY_URL at the top of app.js.
// 6. You can now delete the apiKeyInput/localStorage key entirely from index.html,
//    or leave it as an optional fallback for users who want to use their own key.

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // tighten to your GitHub Pages domain once deployed
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const { prompt } = await request.json();
      if (!prompt || typeof prompt !== "string") {
        return new Response(JSON.stringify({ error: "Missing 'prompt' in request body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ error: "Server misconfigured: GEMINI_API_KEY not set" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );

      const data = await geminiRes.json();
      return new Response(JSON.stringify(data), {
        status: geminiRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

import { config } from "./config.js";
import { excerpt, stripMarkdown } from "./utils.js";

function localAssist(title, content) {
  const plain = stripMarkdown(content);
  const words = plain
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
  const stopWords = new Set(["the", "and", "for", "with", "this", "that", "from", "into", "about", "your"]);
  const freq = new Map();
  for (const word of words) {
    if (!stopWords.has(word)) freq.set(word, (freq.get(word) || 0) + 1);
  }
  const tags = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  return {
    summary: excerpt(plain || title, 140),
    tags: tags.length ? tags : ["随笔"],
    source: "local"
  };
}

export async function generatePostAssist({ title, content }) {
  if (!config.ai.apiKey) return localAssist(title, content);

  const response = await fetch(`${config.ai.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.ai.apiKey}`
    },
    body: JSON.stringify({
      model: config.ai.model,
      messages: [
        {
          role: "system",
          content:
            "You help a blog owner prepare post metadata. Return strict JSON with keys summary and tags. summary must be concise Chinese text. tags must be 3 to 5 short strings."
        },
        {
          role: "user",
          content: `Title: ${title}\n\nMarkdown:\n${content}`
        }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) throw new Error(`Metadata generation failed: ${response.status}`);
  const result = await response.json();
  const text = result.choices?.[0]?.message?.content || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return localAssist(title, content);

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    summary: String(parsed.summary || excerpt(content, 140)),
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(String) : [],
    source: "ai"
  };
}

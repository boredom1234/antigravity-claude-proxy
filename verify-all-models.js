const models = [
  // Claude models
  "claude-opus-4-5-thinking",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-thinking",

  // Gemini 2.5 models
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-thinking",
  "gemini-2.5-pro",

  // Gemini 3 models
  "gemini-3-flash",
  "gemini-3-pro-high",
  "gemini-3-pro-image",
  "gemini-3-pro-low",
];

async function testModel(modelId) {
  console.log(`\nTesting model: ${modelId}...`);
  try {
    const response = await fetch("http://localhost:8672/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
        max_tokens: 10, // keeping it short
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ Failed: ${response.status} - ${text}`);
      return false;
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      console.log(`✅ Success`);
      return true;
    } else {
      console.error(`❌ Invalid response format:`, JSON.stringify(data));
      return false;
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log("Starting model verification...");
  const results = [];

  for (const model of models) {
    const success = await testModel(model);
    results.push({ model, success });
    // Small delay to be nice to the server/rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\nSummary:");
  console.table(results);

  const failures = results.filter((r) => !r.success);
  if (failures.length > 0) {
    console.error(`\n${failures.length} models failed.`);
    process.exit(1);
  } else {
    console.log("\nAll models passed!");
  }
}

runTests();

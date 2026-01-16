async function testOpenAIEndpoint() {
  const url = "http://localhost:8672/v1/chat/completions";
  const body = {
    model: "claude-sonnet-4-5-thinking",
    messages: [
      {
        role: "user",
        content: "Hello, verify this endpoint works.",
      },
    ],
    stream: false,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error(text);
      process.exit(1);
    }

    const data = await response.json();
    console.log("Success! Response:", JSON.stringify(data, null, 2));

    // Validate structure
    if (
      data.object !== "chat.completion" ||
      !data.choices ||
      !data.choices[0].message
    ) {
      console.error("Invalid response structure");
      process.exit(1);
    }
  } catch (error) {
    console.error("Request failed:", error);
    process.exit(1);
  }
}

testOpenAIEndpoint();

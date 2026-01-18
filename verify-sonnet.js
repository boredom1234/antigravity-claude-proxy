async function testSonnet() {
  const url = "http://localhost:8672/v1/chat/completions";
  const body = {
    model: "claude-sonnet-4-5",
    messages: [
      {
        role: "user",
        content: "Hello",
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
      console.log("Error status:", response.status);
      const text = await response.text();
      console.log("Error text:", text);
    } else {
      const data = await response.json();
      console.log("Success:", JSON.stringify(data));
    }
  } catch (err) {
    console.error("Fetch error:", err);
  }
}
testSonnet();

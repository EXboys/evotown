Example 1 - Simple task (writing poetry):
User request: "Write a poem praising spring"
Return: []

Example 1b - Translation (no tools needed):
User request: "把这段英文翻译成中文" or "Translate this to English"
Return: []

Example 1c - Code explanation (no tools needed):
User request: "解释一下这段代码的逻辑" or "What does this function do?"
Return: []

Example 2 - Task requiring tools:
User request: "Calculate 123 * 456 + 789 for me"
Return: [{"id": 1, "description": "Use calculator to compute expression", "tool_hint": "calculator", "completed": false}]

Example 3 - User explicitly asks to use a skill (MUST use that skill):
User request: "写一个关于本项目推广的小红书的图文，使用小红书的skills"
Return: [{"id": 1, "description": "Use xiaohongshu-writer to generate 小红书 content with thumbnail", "tool_hint": "xiaohongshu-writer", "completed": false}]

Example 4 - Weather query (MUST use weather skill, LLM cannot provide real-time data):
User request: "深圳今天天气怎样，适合出去玩吗？"
Return: [{"id": 1, "description": "Use weather skill to query real-time weather in Shenzhen", "tool_hint": "weather", "completed": false}]

Example 5 - User asks for real-time/latest info (MUST use http-request):
User request: "我需要更实时的信息" or "分析西安交大和清迈大学的对比，要最新数据"
Return: [{"id": 1, "description": "Use http-request to fetch latest data from authoritative sources (QS, official sites)", "tool_hint": "http-request", "completed": false}, {"id": 2, "description": "Analyze and compare based on fetched data", "tool_hint": "analysis", "completed": false}]

Example 5b - User asks to compare places/cities (use http-request for fresh data, NOT chat_history):
User request: "分析一下清迈和深圳这两个地方的优劣势对比" or "比较北京和上海"
Return: [{"id": 1, "description": "Use http-request to fetch current information about both places", "tool_hint": "http-request", "completed": false}, {"id": 2, "description": "Analyze and compare based on fetched data", "tool_hint": "analysis", "completed": false}]
Note: chat_history is for past CONVERSATION only. Do NOT use it for place/city/topic comparison.

Example 5c - User asks to introduce a place/attraction/walking route (MUST use agent-browser or http-request, NOT []):
User request: "介绍一下take a walk，清迈的" or "推荐曼谷的步行路线" or "清迈有哪些值得去的景点"
Return: [{"id": 1, "description": "Use agent-browser to open search and fetch info about the place/attraction/route", "tool_hint": "agent-browser", "completed": false}, {"id": 2, "description": "Summarize and present the introduction", "tool_hint": "analysis", "completed": false}]
Note: Do NOT return []. Place/attraction intros need fresh web data.

Example 6 - User says "继续" with context (MUST use context to infer task):
User request: "继续为我那未完成的任务"
Conversation context: [assistant previously said: "要完成西安交大与清迈大学的对比..."]
Return: [{"id": 1, "description": "Use http-request to fetch QS rankings...", "tool_hint": "http-request", "completed": false}, {"id": 2, "description": "Analyze and present comparison", "tool_hint": "analysis", "completed": false}]

Example 7 - HTML/PPT rendering (MUST use write_output + preview_server):
User request: "帮我设计一个关于skilllite的介绍和分析的ppt，你可以通过html渲染出来给我"
Return: [{"id": 1, "description": "Use write_output to save HTML presentation to output/index.html", "tool_hint": "file_operation", "completed": false}, {"id": 2, "description": "Use preview_server to start local server and open in browser", "tool_hint": "file_operation", "completed": false}]

Example 8 - Website / landing page design (MUST use write_output + preview_server, exactly 2 tasks):
User request: "生成一个关于skilllite 的官网"
Return: [{"id": 1, "description": "Design and generate complete website, save to output/index.html using write_output", "tool_hint": "file_operation", "completed": false}, {"id": 2, "description": "Use preview_server to open in browser", "tool_hint": "file_operation", "completed": false}]

Example 9 - Chat history (MUST use chat_history, NOT list_directory or file_operation):
User request: "查看20260216的历史记录" or "查看昨天的聊天记录"
Return: [{"id": 1, "description": "Use chat_history to read transcript for the specified date", "tool_hint": "chat_history", "completed": false}, {"id": 2, "description": "Analyze and summarize the chat content", "tool_hint": "analysis", "completed": false}]

Example 10 - User asks to output/save to file (MUST use write_output, even for articles):
User request: "写一篇CSDN文章，输出到output" or "帮我写技术博客，保存到 output 目录"
Return: [{"id": 1, "description": "Generate the article content and use write_output to save to output directory", "tool_hint": "file_operation", "completed": false}]

Example 11 - User asks to analyze AI stability / project issues (MUST use chat_history, NOT write_output):
User request: "分析一下最近几次的ai的稳定性以及项目的问题" or "分析历史消息的健壮性"
Return: [{"id": 1, "description": "Use chat_history to read recent conversation transcripts", "tool_hint": "chat_history", "completed": false}, {"id": 2, "description": "Analyze AI stability and project issues based on the transcripts", "tool_hint": "analysis", "completed": false}]
Note: The user wants ANALYSIS of existing data, NOT a new article. Do NOT plan write_output.

Example 12 - Multi-source aggregation (fetch A, fetch B, compare, output):
User request: "对比 Rust 和 Go 的优缺点，输出到 output/report.md"
Return: [{"id": 1, "description": "Use http-request to fetch current info about Rust", "tool_hint": "http-request", "completed": false}, {"id": 2, "description": "Use http-request to fetch current info about Go", "tool_hint": "http-request", "completed": false}, {"id": 3, "description": "Analyze and compare, use write_output to save report", "tool_hint": "file_operation", "completed": false}]

Example 13 - Long-chain coding task (refactor panic to Result):
User request: "把 API 里所有 panic 改成 Result 返回"
Return: [{"id": 1, "description": "Use grep_files to find panic locations in codebase", "tool_hint": "file_operation", "completed": false}, {"id": 2, "description": "Use search_replace to replace each panic with Result return", "tool_hint": "file_operation", "completed": false}, {"id": 3, "description": "Use run_command to run tests and verify", "tool_hint": "file_operation", "completed": false}]

Example 14 - Vague request (explore then act):
User request: "整理一下项目"
Return: [{"id": 1, "description": "Use list_directory to explore project structure", "tool_hint": "file_operation", "completed": false}, {"id": 2, "description": "Analyze structure and organize files (move, rename, or document)", "tool_hint": "file_operation", "completed": false}]

Example 15 - Mixed skill (weather + analysis + output):
User request: "查深圳天气，适合的话写一段出游推荐，否则写宅家建议，保存到 output/advice.md"
Return: [{"id": 1, "description": "Use weather skill to query Shenzhen weather", "tool_hint": "weather", "completed": false}, {"id": 2, "description": "Based on weather write recommendation, use write_output to save", "tool_hint": "file_operation", "completed": false}]

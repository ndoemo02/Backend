
import OpenAI from "openai";
import { getMenu } from "./tools/menu.js";
import { checkAvailability } from "./tools/stock.js";
import { createOrder } from "./tools/order.js";

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Tool Definitions (JSON Schema for OpenAI)
const tools = [
    {
        type: "function",
        function: {
            name: "get_menu",
            description: "Get the list of menu items for a specific restaurant.",
            parameters: {
                type: "object",
                properties: {
                    restaurant_id: {
                        type: "string",
                        description: "The UUID of the restaurant to fetch the menu for.",
                    },
                },
                required: ["restaurant_id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "check_availability",
            description: "Check if specific menu items are in stock. ALWAYS check before ordering.",
            parameters: {
                type: "object",
                properties: {
                    item_ids: {
                        type: "string",
                        description: "Comma-separated list of item UUIDs to check (e.g., 'uuid1,uuid2').",
                    },
                    restaurant_id: {
                        type: "string",
                        description: "The restaurant UUID (optional but recommended).",
                    }
                },
                required: ["item_ids"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "place_order",
            description: "Place a new order for the customer.",
            parameters: {
                type: "object",
                properties: {
                    restaurant_id: {
                        type: "string",
                        description: "The UUID of the restaurant.",
                    },
                    items: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string", description: "UUID of the menu item" },
                                quantity: { type: "integer", description: "Quantity to order" },
                                mods: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Optional modifications (e.g., 'no onions')"
                                }
                            },
                            required: ["id", "quantity"]
                        },
                    },
                    table_id: { type: "string" },
                    notes: { type: "string" }
                },
                required: ["restaurant_id", "items"],
            },
        },
    },
];

const SYSTEM_PROMPT = `
You are a waiter API assistant exactly mimicking a real waiter. You have direct control over the restaurant system via tools.

YOUR PROCESS LOOP:
1. **IDENTIFY**: Understand what items the user wants.
2. **RESOLVE UUIDs**: If you do not know the UUIDs of the requested items (e.g. user said "schnitzel"), you MUST call \`get_menu\` to find the corresponding Item IDs. Do NOT guess UUIDs.
3. **CHECK STOCK**: Once you have UUIDs, ALWAYS call \`check_availability\` for those UUIDs.
4. **REPORT**: Tell user if items are available (based on tool output).
5. **EXECUTE**: If user confirms (says "tak", "zamawiaj", "ok", "potwierdzam"), AND items are available, call \`place_order\` IMMEDIATELY.

CRITICAL RULES:
- **DO NOT** say "I am ordering" or "Confirmed" without actually calling the \`place_order\` tool.
- If the user confirms an available order, you **MUST** output a tool call to \`place_order\`. Do not output any text before the tool call.
- Do not ask for confirmation twice. If they said "Tak", just do it.
- After the tool executes, confirm to the user with the Order ID returned by the tool.

Context:
Restaurant ID is provided in the system messages.
`;

export default async function handler(req, res) {
    // Only allow POST
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    try {
        const { messages } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ ok: false, error: "messages_array_required" });
        }

        // Prepare full conversation history: System + User History
        const conversation = [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages
        ];

        // Step 1: Call OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: conversation,
            tools: tools,
            tool_choice: "auto",
        });

        const responseMessage = completion.choices[0].message;

        console.log("[AI/Decision] AI chose:", responseMessage.tool_calls ? "TOOL_CALL" : "TEXT_RESPONSE",
            responseMessage.tool_calls ? responseMessage.tool_calls[0].function.name : responseMessage.content);

        // Step 2: Handle Tool Calls (Recursive Loop)
        let finalResponse = completion.choices[0].message;

        while (finalResponse.tool_calls) {
            // Append the assistant's "thinking" (tool call request) to history
            conversation.push(finalResponse);

            // Execute tool calls
            for (const toolCall of finalResponse.tool_calls) {
                const fnName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);
                let result;

                console.log(`[AI/Agent] invoking tool: ${fnName}`, args);

                try {
                    if (fnName === "get_menu") {
                        result = await getMenu(args.restaurant_id);
                    } else if (fnName === "check_availability") {
                        const ids = args.item_ids.split(',').map(s => s.trim());
                        result = await checkAvailability(ids, { restaurantId: args.restaurant_id });
                    } else if (fnName === "place_order") {
                        result = await createOrder({
                            restaurant_id: args.restaurant_id,
                            items: args.items,
                            table_id: args.table_id,
                            notes: args.notes,
                            source: "ai_agent_v1"
                        });
                    } else {
                        result = { error: "function_not_found" };
                    }
                } catch (err) {
                    console.error(`[AI/Agent] Tool execution error (${fnName}):`, err.message);
                    result = { error: err.message };
                }

                // Append tool result to history
                conversation.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(result)
                });
            }

            // Re-call OpenAI with tool outputs
            const nextCompletion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: conversation,
                tools: tools,
                tool_choice: "auto",
            });

            finalResponse = nextCompletion.choices[0].message;
        }

        console.log("[AI/Agent] Final response generated");
        return res.status(200).json({
            ok: true,
            message: finalResponse,
            history: conversation
        });

        // No tool calls, just return the text response
        return res.status(200).json({
            ok: true,
            message: responseMessage
        });

    } catch (err) {
        console.error("[AI/Agent] Critical Error:", err);
        return res.status(500).json({
            ok: false,
            error: "internal_agent_error",
            message: err.message
        });
    }
}

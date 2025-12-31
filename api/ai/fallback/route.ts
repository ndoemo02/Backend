import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

export const config = {
    runtime: 'edge',
};

export async function POST(req: Request) {
    try {
        const { text } = await req.json();

        if (!text) {
            return new Response(JSON.stringify({ error: 'Missing text' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const { text: responseText } = await generateText({
            model: openai('gpt-4o'),
            prompt: text,
        });

        return new Response(JSON.stringify({ response: responseText }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

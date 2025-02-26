import { openai } from '@ai-sdk/openai';
import { streamText, embed } from 'ai';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import OpenAI from 'openai';
import { traceable } from 'langsmith/traceable';
import { AISDKExporter } from 'langsmith/vercel';
import { wrapOpenAI } from 'langsmith/wrappers';

// Initialize LangSmith
if (!process.env.LANGSMITH_API_KEY) {
  console.warn('LANGSMITH_API_KEY not found in environment variables');
}

// Configure LangSmith settings
const langsmithConfig = {
  projectName: process.env.LANGSMITH_PROJECT || 'default',
  apiKey: process.env.LANGSMITH_API_KEY,
  endpoint: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com'
};

// LangSmith metadata (excluding sensitive info)
const getLangSmithMetadata = () => ({
  projectName: langsmithConfig.projectName,
  endpoint: langsmithConfig.endpoint
});

// Types
interface ChatHistory {
  role: 'user' | 'assistant';
  content: string;
}

interface Document {
  id: string;
  text: string;
  title: string;
  url: string;
  chunk_id: string;
  similarity_score: number;
}

interface PipelineResponse {
  text: string;
  type: string;
  metadata: {
    input: string;
    output: string;
    contextCount: number;
    rewrittenQuery: string;
    responseType: string;
  };
}

// Utility functions
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Initialize DB service
class DatabaseService {
  private client: Pool;
  constructor() {
    this.client = new Pool({ 
      connectionString: process.env.POSTGRES_URL!,
      connectionTimeoutMillis: 10000, // 10 seconds timeout
      max: 20, // Maximum number of clients
      idleTimeoutMillis: 30000 // How long a client is allowed to remain idle
    });
  }

  async searchNeonDb(queryEmbedding: number[], tableName: string, topK: number = 10): Promise<Document[]> {
    console.log('📊 [DB Search] Function called with:', {
      tableName,
      topK,
      embeddingLength: queryEmbedding.length
    });
    
    const embeddingStr = `[${queryEmbedding.join(',')}]`;
    const query = `
      SELECT id, text, title, url, chunk_id,
             1 - (vector <=> $1::vector) as similarity_score
      FROM ${tableName}
      WHERE vector IS NOT NULL
      ORDER BY vector <=> $1::vector
      LIMIT $2;
    `;
    
    try {
      const result = await this.client.query(query, [embeddingStr, topK]);
      console.log('✅ [DB Search] Successfully found documents:', {
        count: result.rows.length,
        table: tableName
      });
      return result.rows.map(row => ({
        id: row.id,
        text: row.text,
        title: row.title,
        url: row.url,
        chunk_id: row.chunk_id,
        similarity_score: parseFloat(row.similarity_score)
      }));
    } catch (error) {
      console.error('❌ [DB Search] Error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        table: tableName
      });
      throw error;
    }
  }
}

const dbService = new DatabaseService();

// Initialize OpenAI client
const openaiClient = wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

// Add these functions before the POST handler
type RelevanceResult = 'GREETING' | 'RELEVANT' | 'INAPPROPRIATE' | 'NOT_RELEVANT';

async function checkRelevance(query: string, chatHistory: ChatHistory[]) {
  console.log('🔍 [Relevance Check] Function called:', {
    query,
    historyLength: chatHistory.length
  });
  const relevancePrompt = `Given this question and chat history, determine if it is:
1. A greeting/send-off (GREETING)
2. Related to woodworking/tools/company (RELEVANT)
3. Inappropriate content (INAPPROPRIATE)
4. Unrelated (NOT_RELEVANT)

Chat History: ${JSON.stringify(chatHistory.slice(-5))}
Current Question: ${query}

Response (GREETING, RELEVANT, INAPPROPRIATE, or NOT_RELEVANT):`;

  const result = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: relevancePrompt }],
    temperature: 0
  });
  console.log('🔍 [Relevance Check] Result:', {
    query,
    result: result.choices[0].message.content
  });
  return result.choices[0].message.content?.trim().toUpperCase() || 'NOT_RELEVANT';
}

async function rewriteQuery(query: string, chatHistory: ChatHistory[] = []) {
  console.log('✍️ [Query Rewrite] Function called:', {
    query,
    historyLength: chatHistory.length
  });
  const rewritePrompt = `You are bent's woodworks assistant so question will be related to wood shop. 
Rewrites user query to make them more specific and searchable, taking into account 
the chat history if provided. Only return the rewritten query without any explanations.

Original query: ${query}
Chat history: ${JSON.stringify(chatHistory)}

Rewritten query:`;

  try {
    const result = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: rewritePrompt }],
      temperature: 0
    });
    const cleanedResponse = result.choices[0].message.content?.replace("Rewritten query:", "").trim();
    return cleanedResponse || query;
  } catch (error) {
    return query;
  }
}

// Updated System Instructions
const SYSTEM_INSTRUCTIONS = `You are an AI assistant representing Jason Bent's woodworking expertise. Your role is to:
1. Analyze woodworking documents and provide clear, natural responses that sound like Jason Bent is explaining the concepts.
2. Convert technical content into conversational, easy-to-understand explanations.
3. Focus on explaining the core concepts and techniques rather than quoting directly from transcripts.
4. Always maintain a friendly, professional tone as if Jason Bent is speaking directly to the user.
5. Organize multi-part responses clearly with natural transitions.
6. Keep responses concise and focused on the specific question asked.
7. If information isn't available in the provided context, clearly state that.
8. Always respond in English, regardless of the input language.
9. Avoid using phrases like "in the video" or "the transcript shows" - instead, speak directly about the techniques and concepts.

Response Structure and Formatting:
   - Use markdown formatting with clear hierarchical structure
   - Each major section must start with '### ' followed by a number and bold title
   - Format section headers as: ### 1. **Title Here**
   - Use bullet points (-) for detailed explanations under each section
   - Each bullet point must contain 2-3 sentences minimum with examples
   - Add blank lines between major sections only
   - Indent bullet points with proper spacing
   - Do NOT use bold formatting (**) or line breaks within bullet point content
   - Bold formatting should ONLY be used in section headers
   - Keep all content within a bullet point on the same line
   - Any asterisks (*) in the content should be treated as literal characters, not formatting



Remember:
- You are speaking as Jason Bent's AI assistant and so if you are mentioning jason bent, you should use the word "Jason Bent" instead of "I" like "Jason Bent will suggest that you..."
- Focus on analyzing the transcripts and explaining the concepts naturally rather than quoting transcripts
- Keep responses clear, practical, and focused on woodworking expertise
`;

export const runtime = 'edge';
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return new Response(JSON.stringify({ 
        error: 'Invalid JSON in request body' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Validate request body
    if (!body || !Array.isArray(body.messages)) {
      return new Response(JSON.stringify({ 
        error: 'Invalid request format. Expected messages array.' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const messages = body.messages;
    const lastUserMessage = messages.findLast(
      (msg: { role: string; content: string }) => msg.role === 'user'
    )?.content || '';

    // Validate LangSmith configuration
    if (!process.env.LANGSMITH_API_KEY) {
      console.error('LangSmith API key not configured');
      return new Response(JSON.stringify({ 
        error: 'LangSmith configuration error' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const pipeline = traceable(async (messages: ChatHistory[], lastUserMessage: string): Promise<PipelineResponse> => {
      // Existing relevance check and query rewrite logic remains
      const relevanceResult = await checkRelevance(lastUserMessage, messages);
      
      if (relevanceResult === 'GREETING' || relevanceResult === 'INAPPROPRIATE' || relevanceResult === 'NOT_RELEVANT') {
        if (relevanceResult === 'GREETING') {
          // Get complete response for tracing
          const completion = await openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ 
              role: 'user', 
              content: `The following message is a greeting or casual message. Please provide a friendly and engaging response: ${lastUserMessage}` 
            }],
          });
          const answer = completion.choices[0].message.content || '';
          return { text: answer, type: 'greeting', metadata: { input: lastUserMessage, output: answer, contextCount: 0, rewrittenQuery: '', responseType: 'greeting' } };
        }
        if (relevanceResult === 'INAPPROPRIATE') {
          const answer = "I apologize, but I cannot assist with inappropriate content or queries that could cause harm. I'm here to help with woodworking and furniture making questions only.";
          return { text: answer, type: 'inappropriate', metadata: { input: lastUserMessage, output: answer, contextCount: 0, rewrittenQuery: '', responseType: 'inappropriate' } };
        }
        if (relevanceResult === 'NOT_RELEVANT') {
          // Get complete response for tracing
          const completion = await openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'user',
                content: `The following question is not directly related to woodworking or the assistant's expertise. Provide a direct response that:
                1. Politely acknowledges the question
                2. Explains that you are specialized in woodworking and Jason Bent's content
                3. Asks them to rephrase their question to relate to woodworking topics
                Question: ${lastUserMessage}`
              }
            ],
          });
          const answer = completion.choices[0].message.content || '';
          return { text: answer, type: 'not-relevant', metadata: { input: lastUserMessage, output: answer, contextCount: 0, rewrittenQuery: '', responseType: 'not-relevant' } };
        }
      }

      // For RELEVANT messages, continue with existing logic
      const rewrittenQuery = await rewriteQuery(lastUserMessage, messages);
      
      // Continue with existing embedding logic using rewrittenQuery
      console.log('⏳ [POST] Generating embedding');
      const { embedding } = await embed({
        model: openai.embedding('text-embedding-ada-002'),
        value: rewrittenQuery,
        maxRetries: 2,
        abortSignal: AbortSignal.timeout(5000)
      });
      console.log('✅ [POST] Embedding generated:', {
        length: embedding.length
      });
      
      // Before DB search
      console.log('⏳ [POST] Searching database');
      const similarDocs = await dbService.searchNeonDb(embedding, "bents", 10);
      console.log('✅ [POST] Found similar documents:', {
        count: similarDocs.length
      });

      const contextTexts = similarDocs.map(doc => 
        `Source: ${doc.title}\nContent: ${doc.text}\nURL: ${doc.url}`
      ).join('\n\n');

      // Only make links request for RELEVANT messages that have context
      if (contextTexts) {
        console.log('📤 [Chat] Sending data to links route:', {
          messagesCount: messages.length,
          contextLength: contextTexts.length,
          rewrittenQuery
        });

        const linksResponse = await fetch(new URL('/api/links', req.url), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            context: contextTexts,
            query: rewrittenQuery
          })
        });

        const linksData = await linksResponse.json();
        console.log('📥 [Chat] Received response from links route:', {
          status: linksResponse.status,
          hasVideoRefs: Boolean(linksData?.videoReferences),
          hasProducts: Boolean(linksData?.relatedProducts)
        });
      }

      // Get complete response for tracing
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTIONS },
          { 
            role: "user", 
            content: `Chat History:\n${JSON.stringify(messages.slice(-5))}\n\nContext:\n${contextTexts}\n\nQuestion: ${lastUserMessage}` 
          }
        ],
      });
      
      const answer = completion.choices[0].message.content || '';
      return { 
        text: answer, 
        type: 'chat',
        metadata: {
          input: lastUserMessage,
          output: answer,
          contextCount: similarDocs?.length || 0,
          rewrittenQuery,
          responseType: 'chat'
        }
      };
    }, {
      name: 'chat-pipeline',
      metadata: {
        ...getLangSmithMetadata(),
        type: 'chat-completion',
        sessionId: Date.now().toString()
      }
    });

    // Get complete response and trace it
    const response = await pipeline(messages, lastUserMessage);
    
    try {
      // Log to LangSmith with error handling
      AISDKExporter.getSettings({
        runName: `${response.type}-completion`,
        metadata: {
          ...response.metadata,
          ...getLangSmithMetadata(),
          type: `${response.type}-completion`
        }
      });
    } catch (langsmithError) {
      console.error('LangSmith logging error:', langsmithError);
      // Continue execution even if LangSmith logging fails
    }

    // Then stream to user
    try {
      return streamText({
        model: openai('gpt-4o-mini'),
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTIONS },
          ...messages,
          { role: "assistant", content: response.text }
        ],
        experimental_telemetry: {
          metadata: {
            ...response.metadata,
            ...getLangSmithMetadata(),
            type: `${response.type}-stream`
          }
        }
      }).toDataStreamResponse();
    } catch (streamError) {
      console.error('Streaming error:', streamError);
      return new Response(JSON.stringify({ 
        error: 'Failed to stream response',
        details: streamError instanceof Error ? streamError.message : 'Unknown streaming error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('API route error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

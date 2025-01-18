'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowRight, PlusCircle, ArrowDown } from 'lucide-react';
import { useChat } from 'ai/react';
import { Button } from "@/components/ui/button";
import { v4 as uuidv4 } from 'uuid';
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from 'react-markdown';
import axios from 'axios';
import Header from '@/components/Header';
import YouTube from 'react-youtube';
import { useAuth } from '@clerk/nextjs';
import { useSession } from '@/lib/hooks/useSession';

// Types
interface Conversation {
  id: string;
  question: string;
  text: string;
  initial_answer?: string;
  videoLinks?: VideoLinks;
  related_products?: Product[];
  timestamp: string;
}

interface Session {
  id: string;
  conversations: Conversation[];
}

interface VideoInfo {
  urls: string[];
  video_title?: string;
  description?: string;
  timestamp?: string;
}

interface VideoLinks {
  [key: string]: {
    urls: string[];
    timestamp: string;
    video_title: string;
    description: string;
  };
}

interface Product {
  id: string;
  title: string;
  link: string;
  tags: string[];
  description?: string;
  price?: string;
  category?: string;
  image_data?: string;
}

interface FAQQuestion {
  id: string;
  question_text: string;
  category?: string;
}

// Add new interface for active query
interface ActiveQuery {
  question: string;
  messageId?: string;
  timestamp?: string;
}

// Constants
const LOCAL_STORAGE_KEY = 'chat_sessions';
const processingSteps = [
  "Understanding query",
  "Searching knowledge base",
  "Processing data",
  "Generating answer"
];

// Font family constant
const systemFontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Helper functions
const getYoutubeVideoId = (url: string): string | null => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

const getStartTime = (timestamp: string): number => {
  const [minutes, seconds] = timestamp.split(':').map(Number);
  return (minutes * 60) + seconds;
};

// Helper function to load saved data
const loadSavedData = async () => {
  try {
    const response = await axios.get('/api/session');
    const savedSessions = response.data;
    
    if (Array.isArray(savedSessions) && savedSessions.length > 0) {
      return {
        sessions: savedSessions,
        currentId: savedSessions[0].id,
        conversations: savedSessions[0].conversations || []
      };
    }
  } catch (error) {
    console.error('Error loading saved data:', error);
  }
  
  const defaultSession = { id: uuidv4(), conversations: [] };
  return {
    sessions: [defaultSession],
    currentId: defaultSession.id,
    conversations: []
  };
};

// Add function to save sessions to database
const saveSessionsToDatabase = async (sessions: Session[]) => {
  try {
    await axios.post('/api/session', {
      sessionData: sessions
    });
  } catch (error) {
    console.error('Error saving sessions to database:', error);
  }
};

const ProductCard = ({ product }: { product: Product }) => {
  return (
    <a
      href={product.link}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-none bg-white rounded-lg border min-w-[180px] px-4 py-3 hover:bg-gray-50 transition-colors"
    >
      <p className="text-sm font-medium text-gray-900">
        {product.title}
      </p>
    </a>
  );
};

// Updated FixedMarkdownRenderer component
const FixedMarkdownRenderer = ({ content }: { content: string }) => (
  <ReactMarkdown
    className="markdown-content"
    components={{
      root: ({ children, ...props }) => (
        <div className="w-full text-gray-800" {...props}>{children}</div>
      ),
      p: ({ children, ...props }) => (
        <p 
          className="text-base leading-relaxed mb-3"
          style={{ fontFamily: systemFontFamily }}
          {...props}
        >
          {children}
        </p>
      ),
      pre: ({ children, ...props }) => (
        <pre className="w-full p-4 rounded bg-gray-50 my-4 overflow-x-auto" {...props}>
          {children}
        </pre>
      ),
      code: ({ children, inline, ...props }) => (
        inline ? 
          <code className="px-1.5 py-0.5 rounded bg-gray-100 text-sm font-mono" {...props}>{children}</code> :
          <code className="block w-full font-mono text-sm" {...props}>{children}</code>
      ),
      ul: ({ children, ...props }) => (
        <ul className="list-disc pl-4 mb-3 space-y-1" {...props}>{children}</ul>
      ),
      ol: ({ children, ...props }) => (
        <ol className="list-decimal pl-4 mb-3 space-y-1" {...props}>{children}</ol>
      ),
      li: ({ children, ...props }) => (
        <li className="mb-1" {...props}>{children}</li>
      ),
      h1: ({ children, ...props }) => (
        <h1 className="text-xl font-medium mb-3" {...props}>{children}</h1>
      ),
      h2: ({ children, ...props }) => (
        <h2 className="text-lg font-medium mb-3" {...props}>{children}</h2>
      ),
      h3: ({ children, ...props }) => (
        <h3 className="text-base font-medium mb-2" {...props}>{children}</h3>
      ),
      blockquote: ({ children, ...props }) => (
        <blockquote 
          className="border-l-4 border-gray-200 pl-4 my-4 italic"
          {...props}
        >
          {children}
        </blockquote>
      ),
      a: ({ children, href, ...props }) => (
        <a 
          href={href}
          className="text-blue-600 hover:text-blue-800 underline"
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        >
          {children}
        </a>
      )
    }}
  >
    {content}
  </ReactMarkdown>
);

// Add these utility functions at the top with other utility functions
const getYoutubeVideoIds = (urls: string[]) => {
  if (!urls || !Array.isArray(urls) || urls.length === 0) return [];
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  return urls.map(url => {
    if (!url || typeof url !== 'string') return null;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }).filter((id): id is string => id !== null);
};

// Updated ConversationItem component
const ConversationItem = ({ conv, index, isLatest }: { 
  conv: Conversation; 
  index: number;
  isLatest: boolean;
}) => {
  const conversationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLatest) {
      conversationRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isLatest]);

  return (
    <div ref={conversationRef} key={conv.id} className="w-full bg-white rounded-lg shadow-sm p-6 mb-4">
      {/* Question Section */}
      <div className="mb-4 pb-4 border-b">
        <div className="flex items-center gap-2">
          <p className="text-gray-800 break-words font-bold" style={{ fontFamily: systemFontFamily }}>
            {conv.question}
          </p>
        </div>
      </div>

      {/* Answer Section */}
      <div className="prose prose-sm max-w-none mb-4">
        <FixedMarkdownRenderer content={conv.text} />
      </div>

      {/* Videos Section */}
      {conv.videoLinks && Object.keys(conv.videoLinks).length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-4">Related Videos</h3>
          <div className="relative">
            <div className="overflow-x-auto custom-scrollbar scroll-smooth">
              <div className="flex gap-4 pb-4 min-w-min">
                {Object.entries(conv.videoLinks).map(([key, video]) => {
                  const videoId = getYoutubeVideoId(video.urls[0]);
                  if (!videoId) return null;

                  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
                  const fullVideoUrl = video.urls[0].split('&t=')[0];

                  return (
                    <div
                      key={`${conv.id}-${key}`}
                      className="flex-shrink-0 w-[250px] bg-white rounded-[8px] border shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col"
                    >
                      <a
                        href={`${video.urls[0]}${video.timestamp ? `&t=${getStartTime(video.timestamp)}s` : ''}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block flex-grow"
                      >
                        <div className="relative">
                          <img 
                            src={thumbnailUrl}
                            alt={video.video_title || 'Video thumbnail'}
                            className="w-full h-[140px] object-cover"
                          />
                        </div>
                        <div className="p-3 flex-grow">
                          <h4 className="font-medium text-sm line-clamp-2 mb-2">
                            {video.video_title || 'Video Title'}
                          </h4>
                          {video.description && (
                            <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                              {video.description}
                            </p>
                          )}
                          {video.timestamp && (
                            <div className="flex items-center text-sm text-gray-500 mb-2">
                              <span>Starts at {video.timestamp}</span>
                            </div>
                          )}
                          <a
                            href={fullVideoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block text-sm text-blue-600 hover:text-blue-800 font-medium mt-2"
                          >
                            Watch Full Video
                          </a>
                        </div>
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Products Section */}
      {conv.related_products && conv.related_products.length > 0 && (
        <div className="mt-6">
          <h3 className="text-base font-semibold mb-3" style={{ fontFamily: systemFontFamily }}>
            Related Products
          </h3>
          <div className="flex overflow-x-auto space-x-4 pb-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
            {conv.related_products.map((product) => (
              <div
                key={`${conv.id}-${product.id}`}
                className="flex-none bg-white rounded-lg border min-w-[180px] px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                <a
                  href={product.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <p className="text-sm font-medium text-gray-900 mb-1">
                    {product.title}
                  </p>
                  {product.description && (
                    <p className="text-sm text-gray-600 line-clamp-2">
                      {product.description}
                    </p>
                  )}
                  {product.price && (
                    <p className="text-sm font-medium text-gray-900 mt-2">
                      {product.price}
                    </p>
                  )}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Add ProcessingCard component near other component definitions
const ProcessingCard = ({ 
  query, 
  loadingProgress, 
  setLoadingProgress 
}: { 
  query: string, 
  loadingProgress: number,
  setLoadingProgress: React.Dispatch<React.SetStateAction<number>>
}) => {
  const loadingCardRef = useRef<HTMLDivElement>(null);
  const currentStep = Math.min(Math.floor(loadingProgress / 25), 3);

  useEffect(() => {
    if (loadingCardRef.current) {
      setTimeout(() => {
        loadingCardRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }, 100);
    }
  }, []);

  useEffect(() => {
    if (loadingProgress < 100) {
      const timer = setTimeout(() => {
        setLoadingProgress(prev => Math.min(prev + 1, 100));
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [loadingProgress, setLoadingProgress]);

  return (
    <div ref={loadingCardRef} className="w-full bg-white rounded-lg p-6 mb-4">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Processing Your Query</h2>
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-[rgba(23,155,215,255)] border-t-transparent"></div>
        </div>
        
        <div className="space-y-4">
          {processingSteps.map((step, index) => {
            const isComplete = index < currentStep;
            const isCurrent = index === currentStep;
            
            return (
              <div key={step} className="flex items-center gap-3">
                <div 
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center",
                    isComplete || isCurrent ? "bg-[rgba(23,155,215,255)]" : "bg-gray-200"
                  )}
                >
                  {isComplete ? (
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isCurrent ? (
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  ) : (
                    <div className="w-2 h-2 bg-gray-400 rounded-full" />
                  )}
                </div>
                <span className={cn(
                  "text-base",
                  isComplete || isCurrent ? "text-black font-medium" : "text-gray-400"
                )}>
                  {step}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Main Chat Page Component
export default function ChatPage() {
  const { userId = null } = useAuth();
  const LOCAL_STORAGE_KEY = 'chat_sessions';

  // Initial session state setup
  const [sessions, setSessions] = useState(() => {
    try {
      const savedSessions = localStorage.getItem(LOCAL_STORAGE_KEY);
      return savedSessions ? JSON.parse(savedSessions) : [{
        id: uuidv4(),
        conversations: []
      }];
    } catch (error) {
      console.error('Error loading sessions:', error);
      return [{
        id: uuidv4(),
        conversations: []
      }];
    }
  });

  // Current session ID state setup
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    try {
      const savedCurrentSessionId = localStorage.getItem('current_session_id');
      return savedCurrentSessionId || sessions[0]?.id || null;
    } catch (error) {
      console.error('Error loading current session ID:', error);
      return sessions[0]?.id || null;
    }
  });

  // Current conversation state setup
  const [currentConversation, setCurrentConversation] = useState(() => {
    try {
      const savedSessions = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedSessions) {
        const parsedSessions = JSON.parse(savedSessions);
        const savedCurrentSessionId = localStorage.getItem('current_session_id');
        const currentSession = parsedSessions.find((session: Session) => session.id === savedCurrentSessionId);
        return currentSession?.conversations || [];
      }
      return [];
    } catch (error) {
      console.error('Error loading conversation:', error);
      return [];
    }
  });

  // Effect to persist sessions
  useEffect(() => {
    if (sessions.length > 0) {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sessions));
      } catch (error) {
        console.error('Error saving sessions:', error);
      }
    }
  }, [sessions]);

  // Effect to maintain current session
  useEffect(() => {
    if (currentSessionId) {
      try {
        localStorage.setItem('current_session_id', currentSessionId);
        const currentSession = sessions.find((session: Session) => session.id === currentSessionId);
        if (currentSession) {
          setCurrentConversation(currentSession.conversations);
          setShowInitialQuestions(currentSession.conversations.length === 0);
        }
      } catch (error) {
        console.error('Error maintaining current session:', error);
      }
    }
  }, [currentSessionId, sessions]);

  // Update browser refresh handler to work with localStorage
  useEffect(() => {
    const handleBrowserRefresh = async (event: BeforeUnloadEvent) => {
      sessionStorage.setItem('is_refreshing', 'true');
      
      // Create new session without clearing history
      const newSessionId = uuidv4();
      const newSession = { 
        id: newSessionId, 
        conversations: [] 
      };
      
      // Only update current session state, preserve sessions array
      setCurrentSessionId(newSession.id);
      setCurrentConversation([]);
      setShowInitialQuestions(true);
      setSearchQuery("");
      setProcessingQuery("");
      setLoadingProgress(0);
      setIsStreaming(false);
      
      // Save current sessions to localStorage to persist history
      try {
        const currentSessions = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (currentSessions) {
          const parsedSessions = JSON.parse(currentSessions);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([...parsedSessions, newSession]));
        }
      } catch (error) {
        console.error('Error saving sessions:', error);
      }
      
      if (event) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    const handleLoad = () => {
      if (sessionStorage.getItem('is_refreshing') === 'true') {
        try {
          // Restore sessions from localStorage
          const savedSessions = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (savedSessions) {
            const parsedSessions = JSON.parse(savedSessions);
            setSessions(parsedSessions);
            
            // Set to the last session
            const lastSession = parsedSessions[parsedSessions.length - 1];
            setCurrentSessionId(lastSession.id);
            setCurrentConversation(lastSession.conversations);
          }
        } catch (error) {
          console.error('Error loading sessions:', error);
        }
        
        setShowInitialQuestions(true);
        setSearchQuery("");
        setProcessingQuery("");
        setLoadingProgress(0);
        setIsStreaming(false);
        
        sessionStorage.removeItem('is_refreshing');
      }
    };

    window.addEventListener('beforeunload', handleBrowserRefresh);
    window.addEventListener('load', handleLoad);

    return () => {
      window.removeEventListener('beforeunload', handleBrowserRefresh);
      window.removeEventListener('load', handleLoad);
    };
  }, []);

  // Other states
  const [showInitialQuestions, setShowInitialQuestions] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loadingQuestionIndex, setLoadingQuestionIndex] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [processingQuery, setProcessingQuery] = useState<string>("");
  const [randomQuestions, setRandomQuestions] = useState<string[]>([]);

  // Response states
  const [firstResponse, setFirstResponse] = useState<{ question: string; content: string } | null>(null);
  const [secondResponse, setSecondResponse] = useState<{ videoLinks: VideoLinks; relatedProducts: Product[] } | null>(null);
  const [isSecondResponseLoading, setIsSecondResponseLoading] = useState(false);

  // Refs
  const messageEndRef = useRef<HTMLDivElement>(null);
  const currentQuestionRef = useRef<string>("");

  // Add new refs and state for scrolling
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const lastScrollPosition = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);

  const { messages, append, isLoading } = useChat({
    api: '/api/chat',
    initialMessages: [],
    onResponse: (response) => {
      setIsStreaming(true);
      setLoadingProgress(3);
      setError(null);
      setWsError(null);
    },
    onFinish: async (message) => {
      setIsStreaming(false);
      
      const currentQuestion = currentQuestionRef.current;
      if (!currentQuestion?.trim() || !currentSessionId) {
        return;
      }
      
      setIsSecondResponseLoading(true);
      try {
        const linksResponse = await axios.post('/api/links', {
          answer: message.content
        });
        
        if (linksResponse.data.status === 'not_relevant') {
          setIsSecondResponseLoading(false);
          return;
        }
        
        // Create new conversation
        const newConversation = {
          id: uuidv4(),
          question: currentQuestion,
          text: message.content,
          timestamp: new Date().toISOString(),
          videoLinks: linksResponse.data.videoReferences || {},
          related_products: linksResponse.data.relatedProducts || []
        };

        // Update sessions while preserving history
        setSessions((prevSessions: Session[]) => {
          const updatedSessions = prevSessions.map((session: Session) => {
            if (session.id === currentSessionId) {
              return {
                ...session,
                conversations: [...session.conversations, newConversation]
              };
            }
            return session;
          });
          
          // Save to localStorage to persist all sessions
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedSessions));
          return updatedSessions;
        });

        // Update current conversation
        setCurrentConversation((prev: Conversation[]) => [...prev, newConversation]);
        
      } catch (error) {
        console.error('Error in onFinish:', error);
        setError('Error updating chat history');
      } finally {
        setIsSecondResponseLoading(false);
        setProcessingQuery("");
      }
    }
  });

  // Add check if near bottom function
  const checkIfNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    
    const threshold = 100; // pixels from bottom
    const position = container.scrollHeight - container.scrollTop - container.clientHeight;
    return position < threshold;
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Detect if user is scrolling up
    if (container.scrollTop < lastScrollPosition.current) {
      setUserHasScrolled(true);
      setIsAutoScrollEnabled(false);
    }

    // Show/hide scroll button based on position
    setShowScrollButton(!checkIfNearBottom());
    lastScrollPosition.current = container.scrollTop;
  }, [checkIfNearBottom]);

  const scrollToBottom = () => {
    const container = containerRef.current;
    if (!container) return;

    setIsAutoScrollEnabled(true);
    setUserHasScrolled(false);
    
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });
  };

  // Add these useEffects:
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isStreaming || !isAutoScrollEnabled) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });
  }, [isStreaming, isAutoScrollEnabled]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (isStreaming) {
      setIsAutoScrollEnabled(!userHasScrolled);
    } else {
      setUserHasScrolled(false);
      setIsAutoScrollEnabled(true);
    }
  }, [isStreaming]);

  // Update handleSearch
  const handleSearch = async (e: React.FormEvent | null, index?: number) => {
    if (e) e.preventDefault();
    const query = index !== undefined ? randomQuestions[index] : searchQuery;
    
    if (!query.trim() || isLoading) return;
    
    setProcessingQuery(query);
    currentQuestionRef.current = query;
    setShowInitialQuestions(false);
    
    try {
      // If there's no current session, create one
      if (!currentSessionId) {
        await manageSession();
      }
      
      await append({
        role: 'user',
        content: query,
        createdAt: new Date()
      });

      setSearchQuery("");
      
      setTimeout(() => {
        messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (error) {
      console.error('Search Error:', error);
      setError('Error processing your request');
    }
  };

  // Loading State Component
  const LoadingState = () => (
    <div className="w-full">
      <div className="mt-4">
        <div className="bg-white rounded-lg p-4 mb-4">
          <div className="space-y-4">
            {/* Video skeleton loader */}
            <div>
              <h3 className="text-base font-semibold mb-2">Related Videos</h3>
              <div className="flex overflow-x-auto space-x-4">
                {[1, 2].map((i) => (
                  <div key={`video-skeleton-${i}`} className="flex-none w-[280px] bg-white border rounded-lg overflow-hidden">
                    <div className="aspect-video w-full bg-gray-200 animate-pulse" />
                    <div className="p-3">
                      <div className="h-4 bg-gray-200 rounded animate-pulse mb-2" />
                      <div className="h-4 bg-gray-200 rounded animate-pulse w-2/3" />
                    </div>
                  </div>
                ))} 
              </div>
            </div>
            
            {/* Products skeleton loader */}
            <div>
              <h3 className="text-base font-semibold mb-2">Related Products</h3>
              <div className="flex overflow-x-auto space-x-4">
                {[1, 2, 3].map((i) => (
                  <div key={`product-skeleton-${i}`} className="flex-none min-w-[180px] bg-white border rounded-lg px-4 py-3">
                    <div className="h-4 bg-gray-200 rounded animate-pulse mb-2" />
                    <div className="h-4 bg-gray-200 rounded animate-pulse w-2/3" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Replace the existing renderConversations function
  const renderConversations = () => (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full overflow-y-auto scrollbar-none"
        style={{ 
          height: 'calc(100vh - 200px)',
          paddingBottom: '80px',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none'
        }}
      >
        <style jsx global>{`
          div::-webkit-scrollbar {
            display: none;
          }
        `}</style>

        {currentConversation.map((conv: Conversation, index: number) => (
          <ConversationItem 
            key={conv.id}
            conv={conv}
            index={index}
            isLatest={index === currentConversation.length - 1}
          />
        ))}

        {isLoading && !isStreaming && (
          <ProcessingCard 
            key="processing-card"
            query={processingQuery}
            loadingProgress={loadingProgress}
            setLoadingProgress={setLoadingProgress}
          />
        )}

        {(isStreaming || isSecondResponseLoading) && messages.length > 0 && (
          <div key="streaming-response" className="w-full bg-white rounded-lg shadow-sm p-6 mb-4">
            {/* Question Section */}
            <div className="mb-4 pb-4 border-b">
              <div className="flex items-center gap-2">
                <p className="text-gray-800 break-words font-bold" style={{ fontFamily: systemFontFamily }}>
                  {processingQuery}
                </p>
              </div>
            </div>

            {/* Answer Section - Updated to ensure content display */}
            <div className="prose prose-sm max-w-none mb-4">
              <div className="text-base leading-relaxed" style={{ fontFamily: systemFontFamily }}>
                {messages[messages.length - 1]?.content && (
                  <FixedMarkdownRenderer 
                    key={`markdown-${messages[messages.length - 1].id || Date.now()}`} 
                    content={messages[messages.length - 1].content} 
                  />
                )}
              </div>
            </div>

            {/* Loading state for additional content */}
            {isSecondResponseLoading && (
              <div key="loading-state" className="mt-6">
                <LoadingState />
              </div>
            )}
          </div>
        )}

        {/* Floating scroll button */}
        {showScrollButton && (isStreaming || isSecondResponseLoading) && (
          <button
            onClick={scrollToBottom}
            className="fixed bottom-24 right-8 bg-gray-800 text-white rounded-full p-3 shadow-lg hover:bg-gray-700 transition-colors z-50 flex items-center gap-2"
          >
            <ArrowDown className="w-5 h-5" />
            <span className="text-sm font-medium pr-2">New content</span>
          </button>
        )}
      </div>
    </div>
  );

  // Effects
  useEffect(() => {
    const handleWebSocketError = (event: Event) => {
      const customError = {
        type: 'WebSocketError',
        originalMessage: event instanceof ErrorEvent ? event.message : 'Unknown error',
        timestamp: new Date().toISOString()
      };
      
      console.error('WebSocket error:', customError);
      setWsError(customError.originalMessage);
      setIsStreaming(false);
      setLoadingProgress(0);
    };

    window.addEventListener('websocketerror', handleWebSocketError);
    return () => window.removeEventListener('websocketerror', handleWebSocketError);
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const selectedSession = sessions.find((session: Session) => session.id === currentSessionId);
    if (selectedSession) {
      setCurrentConversation(selectedSession.conversations);
      setShowInitialQuestions(selectedSession.conversations.length === 0);
    }
  }, [sessions, currentSessionId]);

  useEffect(() => {
    if (isLoading && loadingProgress < 3) {
      const timer = setTimeout(() => {
        setLoadingProgress(prev => Math.min(prev + 1, 3));
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isLoading, loadingProgress]);

  useEffect(() => {
    const fetchQuestions = async () => {
      try {
        const response = await axios.get('/api/random');
        setRandomQuestions(response.data.map((q: any) => q.question_text));
      } catch (error) {
        console.error('Error fetching questions:', error);
      }
    };

    fetchQuestions();
  }, []);

  // Handlers
  const handleQuestionSelect = (question: string, index: number) => {
    setLoadingQuestionIndex(index);
    setProcessingQuery(question);
    setShowInitialQuestions(false);
    setLoadingProgress(0);
    setCurrentConversation([]); // Clear existing conversations
    
    // Delay the search to allow UI to update
    setTimeout(() => {
      handleSearch(null, index);
    }, 100);
  };

  const handleSessionSelect = (sessionId: string) => {
    const selectedSession = sessions.find((session: Session) => session.id === sessionId);
    if (selectedSession) {
      setCurrentSessionId(sessionId);
      setCurrentConversation(selectedSession.conversations);
      setShowInitialQuestions(selectedSession.conversations.length === 0);
    }
  };

  const saveSessionsToDB = async (updatedSessions: Session[]) => {
    if (!userId) {
      console.log('No user ID available, skipping session save');
      return;
    }

    // Validate and clean sessions data
    const validSessions = updatedSessions.filter(session => 
      session && 
      session.id && 
      Array.isArray(session.conversations) &&
      session.conversations.every(conv => 
        conv.question && 
        conv.text && 
        conv.timestamp
      )
    );

    if (validSessions.length === 0) {
      console.error('No valid sessions to save');
      return;
    }

    try {
      const currentSession = validSessions.find(s => s.id === currentSessionId);
      if (!currentSession) {
        console.error('Current session not found in valid sessions');
        return;
      }

      const response = await axios.post('/api/set-session', { 
        sessions: [currentSession] // Only save the current session
      }, {
        headers: {
          'x-user-id': userId
        }
      });
      
      if (!response.data.success) {
        throw new Error('Failed to save session');
      }

      // Update local state to match database
      setSessions(validSessions);
      
    } catch (error) {
      console.error('Failed to save sessions to database:', error);
      setError('Failed to save chat history');
    }
  };

  const recoverState = useCallback(async () => {
    try {
      if (userId) {
        const response = await axios.get('/api/get-session', {
          headers: { 'x-user-id': userId }
        });
        if (response.data.sessions) {
          setSessions(response.data.sessions);
          setCurrentSessionId(response.data.sessions[0]?.id || '');
        }
      }
    } catch (error) {
      console.error('Failed to recover state:', error);
      setError('Failed to recover chat history');
    }
  }, [userId]);

  useEffect(() => {
    const isRefreshing = sessionStorage.getItem('is_refreshing') === 'true';
    if (userId && (!sessions.length || !currentSessionId) && !isRefreshing) {
      recoverState();
    }
  }, [userId, sessions.length, currentSessionId, recoverState]);

  const handleNewConversation = () => {
    const newSession = { id: uuidv4(), conversations: [] };
    setSessions((prev: Session[]) => {
      const updatedSessions = [...prev, newSession];
      // Save to localStorage to persist history
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedSessions));
      return updatedSessions;
    });
    setCurrentSessionId(newSession.id);
    setCurrentConversation([]);
    setShowInitialQuestions(true);
  };

  const manageSession = async () => {
    const newSession = { id: uuidv4(), conversations: [] };
    setSessions((prev: Session[]) => [...prev, newSession]);
    setCurrentSessionId(newSession.id);
    setCurrentConversation([]);
    return newSession;
  };

  // Main render
  return (
    <div className="flex flex-col min-h-screen bg-[#F8F9FA]">
      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0">
          <div className="min-h-screen">
            <Header 
              sessions={sessions}
              currentSessionId={currentSessionId}
              onSessionSelect={handleSessionSelect}
              onNewConversation={handleNewConversation}
              userId={userId}
            />
            
            {(error || wsError) && (
              <div className="w-full px-4 mt-20 mb-4">
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
                  <strong className="font-bold">Error: </strong>
                  <span className="block sm:inline">{error || wsError}</span>
                  <button
                    className="absolute top-0 right-0 px-4 py-3"
                    onClick={() => {
                      setError(null);
                      setWsError(null);
                    }}
                  >
                    <span className="sr-only">Dismiss</span>
                    <span className="text-red-500">&times;</span>
                  </button>
                </div>
              </div>
            )}
            
            <main className={cn(
              "relative",
              "flex-grow w-full",
              "flex flex-col",
              "pt-32 px-4",
            )}>
              <div className="w-full">
                {currentConversation.length === 0 && showInitialQuestions && !isStreaming && !isLoading ? (
                  // Initial questions view (only show if no conversations exist)
                  <div className="w-full min-h-[calc(100vh-200px)] flex flex-col items-center justify-center">
                    <div className="text-center mb-8">
                      <h1 className="text-2xl font-semibold text-gray-900">
                        A question creates knowledge
                      </h1>
                    </div>
                    
                    <div className="w-full max-w-2xl mx-auto mb-12">
                      <SearchBar 
                        loading={isLoading}
                        searchQuery={searchQuery}
                        processingQuery={processingQuery}
                        onSearch={handleSearch}
                        onNewConversation={handleNewConversation}
                        setSearchQuery={setSearchQuery}
                      />
                    </div>

                    <div className="w-full max-w-2xl grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 mx-auto px-2">
                      {randomQuestions.map((question, index) => (
                        <button
                          key={index}
                          onClick={() => handleQuestionSelect(question, index)}
                          disabled={isLoading && loadingQuestionIndex === index}
                          className={cn(
                            "flex items-center",
                            "border rounded-xl shadow-sm hover:bg-[#F9FAFB]",
                            "ring-offset-background transition-colors",
                            "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                            "w-full p-4 text-left",
                            "bg-transparent",
                            isLoading && loadingQuestionIndex === index ? "opacity-70 cursor-not-allowed" : "cursor-pointer"
                          )}
                        >
                          <span className="text-sm text-gray-900">{question}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  // Updated conversations view with enhanced scrolling
                  renderConversations()
                )}
              </div>
            </main>

            {!showInitialQuestions && (
              <div className="fixed bottom-0 left-0 right-0 bg-white border-t w-full">
                <div className="w-full mx-auto">
                  <SearchBar 
                    loading={isLoading}
                    searchQuery={searchQuery}
                    processingQuery={processingQuery}
                    onSearch={handleSearch}
                    onNewConversation={handleNewConversation}
                    setSearchQuery={setSearchQuery}
                    className="py-6"
                    isLarge={true}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
// SearchBar Component
const SearchBar = ({ 
  loading, 
  searchQuery, 
  processingQuery, 
  onSearch, 
  onNewConversation, 
  setSearchQuery,
  className,
  isLarge = false,
  disabled = false
}: {
  loading: boolean;
  searchQuery: string;
  processingQuery: string;
  onSearch: (e: React.FormEvent) => void;
  onNewConversation: () => void;
  setSearchQuery: (query: string) => void;
  className?: string;
  isLarge?: boolean;
  disabled?: boolean;
}) => {
  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!loading && searchQuery.trim()) {
        onSearch(e);
      }
    }
  };

  const handleButtonClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await onNewConversation();
    } catch (error) {
      console.error('Error creating new conversation:', error);
    }
  };

  return (
    <div className="w-full py-3">
      <form 
        onSubmit={onSearch} 
        className={cn(
          "w-full flex items-center bg-white py-1.5",
          disabled && "bg-gray-50"
        )}
      >
        <Button
          onClick={handleButtonClick}
          variant="ghost"
          size="icon"
          className={cn(
            "flex items-center justify-center flex-shrink-0 ml-4",
            isLarge ? "h-[46px] w-[46px]" : "h-[42px] w-[42px]"
          )}
          disabled={disabled}
        >
          <PlusCircle className={cn(
            isLarge ? "h-6 w-6" : "h-5 w-5",
            "text-gray-400",
            disabled && "text-gray-300"
          )} />
        </Button>

        <Textarea
          value={loading ? processingQuery : searchQuery}
          onChange={(e) => !loading && setSearchQuery(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Ask your question..."
          disabled={disabled}
          className={cn(
            "flex-grow mx-2",
            isLarge ? "text-base" : "text-sm",
            "transition-all duration-200 ease-out",
            "placeholder:text-gray-400",
            "focus:placeholder:opacity-0",
            "resize-none",
            "question-textarea",
            "hide-scrollbar",
            "border-none",
            "focus:outline-none",
            "focus:ring-0",
            "focus-visible:ring-0",
            "focus-visible:outline-none",
            "focus:border-0",
            "active:outline-none",
            "active:ring-0",
            "touch-none",
            "outline-none",
            "flex items-center",
            "py-0",
            "scrollbar-none",
            "overflow-hidden",
            loading && "opacity-50",
            disabled && "bg-transparent cursor-default"
          )}
          style={{
            minHeight: isLarge ? '46px' : '42px',
            height: searchQuery ? 'auto' : isLarge ? '46px' : '42px',
            resize: 'none',
            lineHeight: '1.5',
            outline: 'none',
            boxShadow: 'none',
            paddingTop: isLarge ? '12px' : '10px',
            paddingBottom: isLarge ? '12px' : '10px',
            overflow: 'hidden',
            msOverflowStyle: 'none',
            scrollbarWidth: 'none'
          }}
        />

        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className={cn(
            "flex items-center justify-center flex-shrink-0 mr-4",
            isLarge ? "h-[46px] w-[46px]" : "h-[42px] w-[42px]"
          )}
          disabled={loading || disabled}
        >
          {loading ? (
            <span className="animate-spin">⌛</span>
          ) : (
            <ArrowRight className={cn(
              isLarge ? "h-6 w-6" : "h-5 w-5",
              "text-gray-400",
              disabled && "text-gray-300"
            )} />
          )}
        </Button>
      </form>
    </div>
  );
};


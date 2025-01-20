'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '@clerk/nextjs';

// Types
export interface Conversation {
  id: string;
  question: string;
  text: string;
  initial_answer?: string;
  videoLinks?: {
    [key: string]: {
      urls: string[];
      timestamp: string;
      video_title: string;
      description: string;
    };
  };
  related_products?: Array<{
    id: string;
    title: string;
    link: string;
    tags: string[];
    description?: string;
    price?: string;
    category?: string;
    image_data?: string;
  }>;
  timestamp: string;
}

export interface Session {
  id: string;
  conversations: Conversation[];
}

interface UseSessionReturn {
  sessions: Session[];
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  currentSessionId: string | null;
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  isLoading: boolean;
  error: string | null;
  updateSessionConversations: (sessionId: string, conversation: Conversation) => Promise<Conversation[] | null>;
  createNewSession: () => Promise<string>;
}

// Create a singleton instance to share state across components
let globalSessions: Session[] = [];
let globalCurrentSessionId: string | null = null;

export function useSession(): UseSessionReturn {
  const { userId } = useAuth();
  const [sessions, setSessions] = useState<Session[]>(globalSessions);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(globalCurrentSessionId);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Update global state when local state changes
  const updateGlobalState = useCallback((newSessions: Session[], newCurrentId: string | null) => {
    globalSessions = newSessions;
    globalCurrentSessionId = newCurrentId;
  }, []);

  // Custom setState functions that update both local and global state
  const setSessionsWithGlobal = useCallback((newSessions: Session[] | ((prev: Session[]) => Session[])) => {
    setSessions(prev => {
      const nextSessions = typeof newSessions === 'function' ? newSessions(prev) : newSessions;
      updateGlobalState(nextSessions, currentSessionId);
      return nextSessions;
    });
  }, [currentSessionId, updateGlobalState]);

  const setCurrentSessionIdWithGlobal = useCallback((newId: string | null | ((prev: string | null) => string | null)) => {
    setCurrentSessionId(prev => {
      const nextId = typeof newId === 'function' ? newId(prev) : newId;
      updateGlobalState(sessions, nextId);
      return nextId;
    });
  }, [sessions, updateGlobalState]);

  // Load sessions only once when component mounts
  useEffect(() => {
    const loadSessions = async () => {
      if (!userId || isInitialized) return;

      try {
        const response = await axios.get('/api/get-session', {
          headers: {
            'x-user-id': userId
          }
        });
        const savedSessions = response.data;

        if (Array.isArray(savedSessions) && savedSessions.length > 0) {
          const sortedSessions = savedSessions.sort((a, b) => {
            const aTime = a.conversations[0]?.timestamp || '0';
            const bTime = b.conversations[0]?.timestamp || '0';
            return new Date(bTime).getTime() - new Date(aTime).getTime();
          });
          
          setSessionsWithGlobal(sortedSessions);
          setCurrentSessionIdWithGlobal(sortedSessions[0].id);
        }
      } catch (error) {
        console.error('Error loading sessions:', error);
        setError('Failed to load chat history');
      } finally {
        setIsLoading(false);
        setIsInitialized(true);
      }
    };

    loadSessions();
  }, [userId, isInitialized, setSessionsWithGlobal, setCurrentSessionIdWithGlobal]);

  // Update sessions in database whenever they change
  useEffect(() => {
    const updateDatabase = async () => {
      if (!userId || !isInitialized || sessions.length === 0) return;

      try {
        await axios.post('/api/set-session', 
          { sessions },
          { headers: { 'x-user-id': userId } }
        );
      } catch (error) {
        console.error('Failed to update sessions:', error);
        setError('Failed to save chat history');
      }
    };

    updateDatabase();
  }, [userId, sessions, isInitialized]);

  const updateSessionConversations = useCallback(async (
    sessionId: string,
    newConversation: Conversation
  ): Promise<Conversation[] | null> => {
    if (!userId) return null;

    const updatedSessions = sessions.map(session => {
      if (session.id === sessionId) {
        return {
          ...session,
          conversations: [...session.conversations, newConversation]
        };
      }
      return session;
    });

    setSessionsWithGlobal(updatedSessions);
    const currentSession = updatedSessions.find(s => s.id === sessionId);
    return currentSession?.conversations || null;
  }, [userId, sessions, setSessionsWithGlobal]);

  const createNewSession = useCallback(async () => {
    const newSession = { 
      id: crypto.randomUUID(), 
      conversations: [] 
    };
    
    setSessionsWithGlobal(prev => [newSession, ...prev]);
    setCurrentSessionIdWithGlobal(newSession.id);
    return newSession.id;
  }, [setSessionsWithGlobal, setCurrentSessionIdWithGlobal]);

  return {
    sessions,
    setSessions: setSessionsWithGlobal,
    currentSessionId,
    setCurrentSessionId: setCurrentSessionIdWithGlobal,
    isLoading,
    error,
    updateSessionConversations,
    createNewSession
  };
} 

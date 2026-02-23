import { z } from 'zod';
import pino from 'pino';

/**
 * Environment types for the Twilio Agent Connect
 */
declare const EnvironmentSchema: z.ZodDefault<z.ZodEnum<["dev", "stage", "prod"]>>;
type Environment = z.infer<typeof EnvironmentSchema>;
/**
 * Channel types supported by the framework
 */
declare const ChannelTypeSchema: z.ZodEnum<["sms", "voice"]>;
type ChannelType = z.infer<typeof ChannelTypeSchema>;
/**
 * TAC Configuration schema with environment-aware URL computation
 */
declare const TACConfigSchema: z.ZodObject<{
    environment: z.ZodDefault<z.ZodEnum<["dev", "stage", "prod"]>>;
    twilioAccountSid: z.ZodString;
    twilioAuthToken: z.ZodString;
    twilioPhoneNumber: z.ZodString;
    memoryStoreId: z.ZodOptional<z.ZodString>;
    memoryApiKey: z.ZodOptional<z.ZodString>;
    memoryApiToken: z.ZodOptional<z.ZodString>;
    traitGroups: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    conversationServiceId: z.ZodString;
    voicePublicDomain: z.ZodOptional<z.ZodString>;
    cintelConfigurationId: z.ZodOptional<z.ZodString>;
    cintelObservationOperatorSid: z.ZodOptional<z.ZodString>;
    cintelSummaryOperatorSid: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    environment: "dev" | "stage" | "prod";
    twilioAccountSid: string;
    twilioAuthToken: string;
    twilioPhoneNumber: string;
    conversationServiceId: string;
    memoryStoreId?: string | undefined;
    memoryApiKey?: string | undefined;
    memoryApiToken?: string | undefined;
    traitGroups?: string[] | undefined;
    voicePublicDomain?: string | undefined;
    cintelConfigurationId?: string | undefined;
    cintelObservationOperatorSid?: string | undefined;
    cintelSummaryOperatorSid?: string | undefined;
}, {
    twilioAccountSid: string;
    twilioAuthToken: string;
    twilioPhoneNumber: string;
    conversationServiceId: string;
    environment?: "dev" | "stage" | "prod" | undefined;
    memoryStoreId?: string | undefined;
    memoryApiKey?: string | undefined;
    memoryApiToken?: string | undefined;
    traitGroups?: string[] | undefined;
    voicePublicDomain?: string | undefined;
    cintelConfigurationId?: string | undefined;
    cintelObservationOperatorSid?: string | undefined;
    cintelSummaryOperatorSid?: string | undefined;
}>;
type TACConfigData = z.infer<typeof TACConfigSchema>;
/**
 * Individual observation extracted from conversations
 */
declare const ObservationInfoSchema: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodString;
    createdAt: z.ZodString;
    occurredAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
    conversationIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    source: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    content: string;
    createdAt: string;
    occurredAt?: string | undefined;
    updatedAt?: string | undefined;
    conversationIds?: string[] | null | undefined;
    source?: string | undefined;
}, {
    id: string;
    content: string;
    createdAt: string;
    occurredAt?: string | undefined;
    updatedAt?: string | undefined;
    conversationIds?: string[] | null | undefined;
    source?: string | undefined;
}>;
type ObservationInfo = z.infer<typeof ObservationInfoSchema>;
/**
 * Conversation summary information
 */
declare const SummaryInfoSchema: z.ZodObject<{
    id: z.ZodString;
    content: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodOptional<z.ZodString>;
    conversationIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    id: string;
    content: string;
    createdAt: string;
    updatedAt?: string | undefined;
    conversationIds?: string[] | undefined;
}, {
    id: string;
    content: string;
    createdAt: string;
    updatedAt?: string | undefined;
    conversationIds?: string[] | undefined;
}>;
type SummaryInfo = z.infer<typeof SummaryInfoSchema>;
/**
 * Memory retrieval request parameters
 */
declare const MemoryRetrievalRequestSchema: z.ZodObject<{
    query: z.ZodOptional<z.ZodString>;
    start_date: z.ZodOptional<z.ZodString>;
    end_date: z.ZodOptional<z.ZodString>;
    observation_limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    summary_limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    session_limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    observation_limit: number;
    summary_limit: number;
    session_limit: number;
    query?: string | undefined;
    start_date?: string | undefined;
    end_date?: string | undefined;
}, {
    query?: string | undefined;
    start_date?: string | undefined;
    end_date?: string | undefined;
    observation_limit?: number | undefined;
    summary_limit?: number | undefined;
    session_limit?: number | undefined;
}>;
type MemoryRetrievalRequest = z.infer<typeof MemoryRetrievalRequestSchema>;
/**
 * Memory retrieval response from the Memory API /Recall endpoint.
 *
 * Contains observations, summaries, and communications from Memory API.
 */
declare const MemoryRetrievalResponseSchema: z.ZodObject<{
    observations: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        content: z.ZodString;
        createdAt: z.ZodString;
        occurredAt: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodOptional<z.ZodString>;
        conversationIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        source: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        content: string;
        createdAt: string;
        occurredAt?: string | undefined;
        updatedAt?: string | undefined;
        conversationIds?: string[] | null | undefined;
        source?: string | undefined;
    }, {
        id: string;
        content: string;
        createdAt: string;
        occurredAt?: string | undefined;
        updatedAt?: string | undefined;
        conversationIds?: string[] | null | undefined;
        source?: string | undefined;
    }>, "many">;
    summaries: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        content: z.ZodString;
        createdAt: z.ZodString;
        updatedAt: z.ZodOptional<z.ZodString>;
        conversationIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        content: string;
        createdAt: string;
        updatedAt?: string | undefined;
        conversationIds?: string[] | undefined;
    }, {
        id: string;
        content: string;
        createdAt: string;
        updatedAt?: string | undefined;
        conversationIds?: string[] | undefined;
    }>, "many">;
    communications: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        author: z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            address: z.ZodString;
            channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
            type: z.ZodOptional<z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]>>;
            profile_id: z.ZodOptional<z.ZodString>;
            delivery_status: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        }, {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        }>;
        content: z.ZodObject<{
            text: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            text?: string | undefined;
        }, {
            text?: string | undefined;
        }>;
        recipients: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            address: z.ZodString;
            channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
            type: z.ZodOptional<z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]>>;
            profile_id: z.ZodOptional<z.ZodString>;
            delivery_status: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        }, {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        }>, "many">;
        channel_id: z.ZodOptional<z.ZodString>;
        created_at: z.ZodString;
        updated_at: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        author: {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        };
        content: {
            text?: string | undefined;
        };
        recipients: {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        }[];
        created_at: string;
        channel_id?: string | undefined;
        updated_at?: string | undefined;
    }, {
        id: string;
        author: {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        };
        content: {
            text?: string | undefined;
        };
        recipients: {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        }[];
        created_at: string;
        channel_id?: string | undefined;
        updated_at?: string | undefined;
    }>, "many">>>;
    meta: z.ZodOptional<z.ZodObject<{
        queryTime: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        queryTime?: number | undefined;
    }, {
        queryTime?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    observations: {
        id: string;
        content: string;
        createdAt: string;
        occurredAt?: string | undefined;
        updatedAt?: string | undefined;
        conversationIds?: string[] | null | undefined;
        source?: string | undefined;
    }[];
    summaries: {
        id: string;
        content: string;
        createdAt: string;
        updatedAt?: string | undefined;
        conversationIds?: string[] | undefined;
    }[];
    communications: {
        id: string;
        author: {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        };
        content: {
            text?: string | undefined;
        };
        recipients: {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        }[];
        created_at: string;
        channel_id?: string | undefined;
        updated_at?: string | undefined;
    }[];
    meta?: {
        queryTime?: number | undefined;
    } | undefined;
}, {
    observations: {
        id: string;
        content: string;
        createdAt: string;
        occurredAt?: string | undefined;
        updatedAt?: string | undefined;
        conversationIds?: string[] | null | undefined;
        source?: string | undefined;
    }[];
    summaries: {
        id: string;
        content: string;
        createdAt: string;
        updatedAt?: string | undefined;
        conversationIds?: string[] | undefined;
    }[];
    communications?: {
        id: string;
        author: {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        };
        content: {
            text?: string | undefined;
        };
        recipients: {
            id: string;
            name: string;
            address: string;
            channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
            type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
            profile_id?: string | undefined;
            delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        }[];
        created_at: string;
        channel_id?: string | undefined;
        updated_at?: string | undefined;
    }[] | undefined;
    meta?: {
        queryTime?: number | undefined;
    } | undefined;
}>;
type MemoryRetrievalResponse = z.infer<typeof MemoryRetrievalResponseSchema>;
/**
 * Profile lookup response
 */
declare const ProfileLookupResponseSchema: z.ZodObject<{
    normalizedValue: z.ZodString;
    profiles: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    normalizedValue: string;
    profiles: string[];
}, {
    normalizedValue: string;
    profiles: string[];
}>;
type ProfileLookupResponse = z.infer<typeof ProfileLookupResponseSchema>;
/**
 * Profile response with traits
 */
declare const ProfileResponseSchema: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodString;
    traits: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: string;
    traits: Record<string, unknown>;
}, {
    id: string;
    createdAt: string;
    traits: Record<string, unknown>;
}>;
type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
/**
 * Response from creating an observation
 */
declare const CreateObservationResponseSchema: z.ZodObject<{
    content: z.ZodString;
    source: z.ZodString;
    occurredAt: z.ZodString;
    conversationIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    content: string;
    occurredAt: string;
    conversationIds: string[];
    source: string;
}, {
    content: string;
    occurredAt: string;
    conversationIds: string[];
    source: string;
}>;
type CreateObservationResponse = z.infer<typeof CreateObservationResponseSchema>;
/**
 * Response from creating conversation summaries
 */
declare const CreateConversationSummariesResponseSchema: z.ZodObject<{
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    message: string;
}, {
    message: string;
}>;
type CreateConversationSummariesResponse = z.infer<typeof CreateConversationSummariesResponseSchema>;
/**
 * Communication from Conversations Service API (Maestro).
 *
 * Note: `created_at` is optional per API spec.
 */
declare const CommunicationSchema: z.ZodObject<{
    id: z.ZodString;
    conversation_id: z.ZodString;
    account_id: z.ZodString;
    author: z.ZodObject<{
        address: z.ZodString;
        channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
        participant_id: z.ZodString;
        delivery_status: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participant_id: string;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participant_id: string;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }>;
    content: z.ZodObject<{
        type: z.ZodEnum<["TEXT", "TRANSCRIPTION"]>;
        text: z.ZodString;
        transcription: z.ZodOptional<z.ZodObject<{
            channel: z.ZodOptional<z.ZodNumber>;
            confidence: z.ZodOptional<z.ZodNumber>;
            engine: z.ZodOptional<z.ZodString>;
            words: z.ZodOptional<z.ZodArray<z.ZodObject<{
                text: z.ZodString;
                startTime: z.ZodOptional<z.ZodString>;
                endTime: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }, {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        }, {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        type: "TEXT" | "TRANSCRIPTION";
        text: string;
        transcription?: {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        } | undefined;
    }, {
        type: "TEXT" | "TRANSCRIPTION";
        text: string;
        transcription?: {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        } | undefined;
    }>;
    recipients: z.ZodArray<z.ZodObject<{
        address: z.ZodString;
        channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
        participant_id: z.ZodString;
        delivery_status: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participant_id: string;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participant_id: string;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }>, "many">;
    channel_id: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    author: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participant_id: string;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    };
    content: {
        type: "TEXT" | "TRANSCRIPTION";
        text: string;
        transcription?: {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        } | undefined;
    };
    recipients: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participant_id: string;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }[];
    conversation_id: string;
    account_id: string;
    channel_id?: string | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
}, {
    id: string;
    author: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participant_id: string;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    };
    content: {
        type: "TEXT" | "TRANSCRIPTION";
        text: string;
        transcription?: {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        } | undefined;
    };
    recipients: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participant_id: string;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }[];
    conversation_id: string;
    account_id: string;
    channel_id?: string | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
}>;
type Communication = z.infer<typeof CommunicationSchema>;
/**
 * Profile information for a conversation participant
 */
interface Profile {
    profile_id: string;
    traits?: Record<string, unknown>;
}
/**
 * Conversation session context
 */
declare const ConversationSessionSchema: z.ZodObject<{
    conversation_id: z.ZodString;
    profile_id: z.ZodOptional<z.ZodString>;
    service_id: z.ZodOptional<z.ZodString>;
    channel: z.ZodEnum<["sms", "voice"]>;
    started_at: z.ZodDate;
    author_info: z.ZodOptional<z.ZodObject<{
        address: z.ZodString;
        participant_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        participant_id?: string | undefined;
    }, {
        address: string;
        participant_id?: string | undefined;
    }>>;
    profile: z.ZodOptional<z.ZodType<Profile, z.ZodTypeDef, Profile>>;
    metadata: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, "strip", z.ZodTypeAny, {
    channel: "sms" | "voice";
    started_at: Date;
    conversation_id: string;
    metadata: Record<string, unknown>;
    profile_id?: string | undefined;
    service_id?: string | undefined;
    author_info?: {
        address: string;
        participant_id?: string | undefined;
    } | undefined;
    profile?: Profile | undefined;
}, {
    channel: "sms" | "voice";
    started_at: Date;
    conversation_id: string;
    profile_id?: string | undefined;
    service_id?: string | undefined;
    author_info?: {
        address: string;
        participant_id?: string | undefined;
    } | undefined;
    profile?: Profile | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
type ConversationSession = z.infer<typeof ConversationSessionSchema>;
/**
 * Branded types for type safety
 */
type ConversationId = string & {
    readonly _brand: 'ConversationId';
};
type ProfileId = string & {
    readonly _brand: 'ProfileId';
};
/**
 * Conversation response from Conversations Service API
 */
declare const ConversationResponseSchema: z.ZodObject<{
    id: z.ZodString;
    accountId: z.ZodString;
    status: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    configurationId: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    accountId: string;
    status?: string | undefined;
    name?: string | null | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
    configurationId?: string | undefined;
}, {
    id: string;
    accountId: string;
    status?: string | undefined;
    name?: string | null | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
    configurationId?: string | undefined;
}>;
type ConversationResponse = z.infer<typeof ConversationResponseSchema>;
/**
 * Participant address from Conversations Service API (camelCase format)
 */
declare const ConversationAddressSchema: z.ZodObject<{
    channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
    address: z.ZodString;
    channelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    address: string;
    channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
    channelId?: string | null | undefined;
}, {
    address: string;
    channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
    channelId?: string | null | undefined;
}>;
type ConversationAddress = z.infer<typeof ConversationAddressSchema>;
/**
 * Participant response from Conversations Service API
 */
declare const ConversationParticipantSchema: z.ZodObject<{
    id: z.ZodString;
    conversationId: z.ZodString;
    accountId: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]>>;
    profileId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    addresses: z.ZodDefault<z.ZodArray<z.ZodObject<{
        channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
        address: z.ZodString;
        channelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        channelId?: string | null | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        channelId?: string | null | undefined;
    }>, "many">>;
    createdAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    accountId: string;
    conversationId: string;
    addresses: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        channelId?: string | null | undefined;
    }[];
    type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
    name?: string | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
    profileId?: string | null | undefined;
}, {
    id: string;
    accountId: string;
    conversationId: string;
    type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
    name?: string | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
    profileId?: string | null | undefined;
    addresses?: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        channelId?: string | null | undefined;
    }[] | undefined;
}>;
type ConversationParticipant = z.infer<typeof ConversationParticipantSchema>;

/**
 * JSON Schema definition for tool parameters
 */
declare const JSONSchemaSchema: z.ZodObject<{
    type: z.ZodEnum<["object", "string", "number", "boolean", "array"]>;
    properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    required: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    items: z.ZodOptional<z.ZodAny>;
    enum: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "string" | "number" | "boolean" | "object" | "array";
    properties?: Record<string, any> | undefined;
    required?: string[] | undefined;
    items?: any;
    enum?: any[] | undefined;
    description?: string | undefined;
}, {
    type: "string" | "number" | "boolean" | "object" | "array";
    properties?: Record<string, any> | undefined;
    required?: string[] | undefined;
    items?: any;
    enum?: any[] | undefined;
    description?: string | undefined;
}>;
type JSONSchema = z.infer<typeof JSONSchemaSchema>;
/**
 * Tool function signature
 */
type ToolFunction<TParams = any, TResult = any> = (params: TParams) => Promise<TResult> | TResult;
/**
 * OpenAI tool format
 */
declare const OpenAIToolSchema: z.ZodObject<{
    type: z.ZodLiteral<"function">;
    function: z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        parameters: z.ZodObject<{
            type: z.ZodEnum<["object", "string", "number", "boolean", "array"]>;
            properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            required: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            items: z.ZodOptional<z.ZodAny>;
            enum: z.ZodOptional<z.ZodArray<z.ZodAny, "many">>;
            description: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "string" | "number" | "boolean" | "object" | "array";
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
            description?: string | undefined;
        }, {
            type: "string" | "number" | "boolean" | "object" | "array";
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
            description?: string | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
        parameters: {
            type: "string" | "number" | "boolean" | "object" | "array";
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
            description?: string | undefined;
        };
    }, {
        name: string;
        description: string;
        parameters: {
            type: "string" | "number" | "boolean" | "object" | "array";
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
            description?: string | undefined;
        };
    }>;
}, "strip", z.ZodTypeAny, {
    function: {
        name: string;
        description: string;
        parameters: {
            type: "string" | "number" | "boolean" | "object" | "array";
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
            description?: string | undefined;
        };
    };
    type: "function";
}, {
    function: {
        name: string;
        description: string;
        parameters: {
            type: "string" | "number" | "boolean" | "object" | "array";
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
            description?: string | undefined;
        };
    };
    type: "function";
}>;
type OpenAITool = z.infer<typeof OpenAIToolSchema>;
/**
 * Tool execution context
 */
interface ToolContext {
    conversationId?: string;
    profileId?: string;
    channel?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Tool execution result
 */
declare const ToolExecutionResultSchema: z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodOptional<z.ZodAny>;
    error: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    success: boolean;
    metadata?: Record<string, unknown> | undefined;
    data?: any;
    error?: string | undefined;
}, {
    success: boolean;
    metadata?: Record<string, unknown> | undefined;
    data?: any;
    error?: string | undefined;
}>;
type ToolExecutionResult = z.infer<typeof ToolExecutionResultSchema>;
/**
 * Result of processing an operator result event
 */
declare const OperatorProcessingResultSchema: z.ZodObject<{
    success: z.ZodBoolean;
    eventType: z.ZodOptional<z.ZodString>;
    skipped: z.ZodDefault<z.ZodBoolean>;
    skipReason: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    createdCount: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    success: boolean;
    skipped: boolean;
    createdCount: number;
    error?: string | undefined;
    eventType?: string | undefined;
    skipReason?: string | undefined;
}, {
    success: boolean;
    error?: string | undefined;
    eventType?: string | undefined;
    skipped?: boolean | undefined;
    skipReason?: string | undefined;
    createdCount?: number | undefined;
}>;
type OperatorProcessingResult = z.infer<typeof OperatorProcessingResultSchema>;
/**
 * Unified communication model with all fields from both Memory and Maestro APIs.
 *
 * Provides complete access to all communication fields regardless of the source.
 * Fields not available from a particular API will be undefined.
 */
declare const TACCommunicationSchema: z.ZodObject<{
    id: z.ZodString;
    author: z.ZodObject<{
        address: z.ZodString;
        channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
        participant_id: z.ZodOptional<z.ZodString>;
        delivery_status: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        type: z.ZodOptional<z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]>>;
        profile_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        profile_id?: string | undefined;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        participant_id?: string | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        profile_id?: string | undefined;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        participant_id?: string | undefined;
    }>;
    content: z.ZodObject<{
        type: z.ZodOptional<z.ZodEnum<["TEXT", "TRANSCRIPTION"]>>;
        text: z.ZodOptional<z.ZodString>;
        transcription: z.ZodOptional<z.ZodObject<{
            channel: z.ZodOptional<z.ZodNumber>;
            confidence: z.ZodOptional<z.ZodNumber>;
            engine: z.ZodOptional<z.ZodString>;
            words: z.ZodOptional<z.ZodArray<z.ZodObject<{
                text: z.ZodString;
                startTime: z.ZodOptional<z.ZodString>;
                endTime: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }, {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        }, {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        type?: "TEXT" | "TRANSCRIPTION" | undefined;
        text?: string | undefined;
        transcription?: {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        } | undefined;
    }, {
        type?: "TEXT" | "TRANSCRIPTION" | undefined;
        text?: string | undefined;
        transcription?: {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        } | undefined;
    }>;
    recipients: z.ZodDefault<z.ZodArray<z.ZodObject<{
        address: z.ZodString;
        channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
        participant_id: z.ZodOptional<z.ZodString>;
        delivery_status: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        type: z.ZodOptional<z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]>>;
        profile_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        profile_id?: string | undefined;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        participant_id?: string | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        profile_id?: string | undefined;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        participant_id?: string | undefined;
    }>, "many">>;
    channel_id: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodOptional<z.ZodString>;
    conversation_id: z.ZodOptional<z.ZodString>;
    account_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    author: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        profile_id?: string | undefined;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        participant_id?: string | undefined;
    };
    content: {
        type?: "TEXT" | "TRANSCRIPTION" | undefined;
        text?: string | undefined;
        transcription?: {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        } | undefined;
    };
    recipients: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        profile_id?: string | undefined;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        participant_id?: string | undefined;
    }[];
    channel_id?: string | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
    conversation_id?: string | undefined;
    account_id?: string | undefined;
}, {
    id: string;
    author: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        profile_id?: string | undefined;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        participant_id?: string | undefined;
    };
    content: {
        type?: "TEXT" | "TRANSCRIPTION" | undefined;
        text?: string | undefined;
        transcription?: {
            channel?: number | undefined;
            confidence?: number | undefined;
            engine?: string | undefined;
            words?: {
                text: string;
                startTime?: string | undefined;
                endTime?: string | undefined;
            }[] | undefined;
        } | undefined;
    };
    recipients?: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        profile_id?: string | undefined;
        delivery_status?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        participant_id?: string | undefined;
    }[] | undefined;
    channel_id?: string | undefined;
    created_at?: string | undefined;
    updated_at?: string | undefined;
    conversation_id?: string | undefined;
    account_id?: string | undefined;
}>;
type TACCommunication = z.infer<typeof TACCommunicationSchema>;
/**
 * Knowledge base metadata (from GET endpoint)
 */
declare const KnowledgeBaseSchema: z.ZodObject<{
    id: z.ZodString;
    displayName: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<["QUEUED", "PROVISIONING", "ACTIVE", "FAILED", "DELETING"]>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    version: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: "FAILED" | "QUEUED" | "PROVISIONING" | "ACTIVE" | "DELETING";
    id: string;
    createdAt: string;
    updatedAt: string;
    description: string;
    displayName: string;
    version: number;
}, {
    status: "FAILED" | "QUEUED" | "PROVISIONING" | "ACTIVE" | "DELETING";
    id: string;
    createdAt: string;
    updatedAt: string;
    description: string;
    displayName: string;
    version: number;
}>;
type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;
/**
 * Search result chunk (from POST search endpoint)
 */
declare const KnowledgeChunkResultSchema: z.ZodObject<{
    content: z.ZodString;
    knowledgeId: z.ZodString;
    createdAt: z.ZodString;
    score: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    content: string;
    createdAt: string;
    knowledgeId: string;
    score?: number | undefined;
}, {
    content: string;
    createdAt: string;
    knowledgeId: string;
    score?: number | undefined;
}>;
type KnowledgeChunkResult = z.infer<typeof KnowledgeChunkResultSchema>;

/**
 * Unified response wrapper for TAC.retrieveMemory().
 *
 * Provides a consistent interface for accessing memory data regardless of whether
 * Memory API is configured or falling back to Maestro Communications API.
 *
 * Memory configured:
 * - observations, summaries, communications all populated
 * - communications include Memory-specific fields (author id, name, type, profile_id)
 *
 * Maestro fallback:
 * - observations and summaries are empty arrays
 * - communications include Maestro-specific fields (conversation_id, account_id, etc.)
 */
declare class TACMemoryResponse {
    private readonly _data;
    private readonly _communications;
    /**
     * Initialize wrapper with either Memory or Maestro data.
     *
     * @param data - Either MemoryRetrievalResponse (Memory) or Communication[] (Maestro)
     */
    constructor(data: MemoryRetrievalResponse | Communication[]);
    /**
     * Get observation memories.
     *
     * @returns List of observations if Memory is configured, empty array for Maestro fallback
     */
    get observations(): ObservationInfo[];
    /**
     * Get summary memories.
     *
     * @returns List of summaries if Memory is configured, empty array for Maestro fallback
     */
    get summaries(): SummaryInfo[];
    /**
     * Get communications in unified format with all available fields.
     *
     * Communications are converted to a common format during initialization that includes
     * all fields from both Memory and Maestro APIs. Fields not available from a particular
     * API will be undefined.
     *
     * @returns List of unified communications with all available fields
     */
    get communications(): TACCommunication[];
    /**
     * Check if Memory API is configured and providing full features.
     *
     * @returns true if Memory is configured (observations/summaries available),
     *          false if using Maestro fallback (only communications available)
     */
    get hasMemoryFeatures(): boolean;
    /**
     * Access raw underlying data for advanced use cases.
     *
     * Use this when you need access to all fields from the original API responses,
     * not just the unified common fields.
     *
     * @returns Either MemoryRetrievalResponse or Communication[] depending on configuration
     */
    get rawData(): MemoryRetrievalResponse | Communication[];
}

/**
 * TAC Configuration class with Python-like static factory methods
 *
 * Example usage:
 * ```typescript
 * // Load from environment variables
 * const config = TACConfig.fromEnv();
 *
 * // Or create manually
 * const config = new TACConfig({
 *   environment: 'prod',
 *   twilioAccountSid: 'ACxxxx',
 *   // ...
 * });
 * ```
 */
declare class TACConfig {
    readonly environment: Environment;
    readonly twilioAccountSid: string;
    readonly twilioAuthToken: string;
    readonly twilioPhoneNumber: string;
    readonly memoryStoreId?: string;
    readonly memoryApiKey?: string;
    readonly memoryApiToken?: string;
    readonly traitGroups?: string[];
    readonly conversationServiceId: string;
    readonly voicePublicDomain?: string;
    readonly cintelConfigurationId?: string;
    readonly cintelObservationOperatorSid?: string;
    readonly cintelSummaryOperatorSid?: string;
    readonly memoryApiUrl: string;
    readonly conversationsApiUrl: string;
    readonly knowledgeApiUrl: string;
    constructor(data: TACConfigData);
    /**
     * Create TACConfig from environment variables.
     *
     * Loads configuration from the following environment variables:
     * - ENVIRONMENT: TAC environment (dev, stage, or prod) - defaults to 'prod'
     * - TWILIO_ACCOUNT_SID: Twilio Account SID (required)
     * - TWILIO_AUTH_TOKEN: Twilio Auth Token (required)
     * - TWILIO_PHONE_NUMBER: Twilio Phone Number (required)
     * - MEMORY_STORE_ID: Memory Store ID (optional, for Twilio Memory)
     * - MEMORY_API_KEY: Memory API Key (optional, required if using Memory)
     * - MEMORY_API_TOKEN: Memory API Token (optional, required if using Memory)
     * - TRAIT_GROUPS: Comma-separated trait group names (optional, for profile fetching)
     * - CONVERSATION_SERVICE_ID: Twilio Conversation Configuration ID (required)
     * - VOICE_PUBLIC_DOMAIN: Public domain for voice webhooks (optional)
     *
     * @throws Error if required environment variables are not set or invalid
     *
     * @example
     * ```typescript
     * // With all env vars set in .env file
     * const config = TACConfig.fromEnv();
     *
     * // Use in TAC initialization
     * const tac = new TAC({ config });
     * ```
     */
    static fromEnv(): TACConfig;
    /**
     * Get basic auth credentials for Twilio APIs
     */
    getBasicAuthCredentials(): {
        username: string;
        password: string;
    };
}

/**
 * Logger type that can be either Pino logger or Fastify's logger
 */
type Logger = pino.Logger;

/**
 * Memory client for interacting with Twilio Memory Service
 *
 * Provides functionality to retrieve user memories including observations,
 * summaries, and conversation sessions.
 */
declare class MemoryClient {
    private readonly baseUrl;
    private readonly credentials;
    private readonly logger;
    constructor(config: TACConfig, logger?: Logger);
    /**
     * Retrieve memories for a specific profile
     *
     * @param serviceSid - The memory service SID
     * @param profileId - The profile ID to retrieve memories for
     * @param request - Optional request parameters for filtering results
     * @returns Promise containing memory retrieval response
     */
    retrieveMemories(serviceSid: string, profileId: string, request?: Partial<MemoryRetrievalRequest>): Promise<MemoryRetrievalResponse>;
    /**
     * Find profiles that contain a specific identifier value
     *
     * @param serviceSid - The memory service SID
     * @param idType - Identifier type (e.g., 'phone', 'email')
     * @param value - Raw value captured for the identifier
     * @returns Promise containing profile lookup response with normalized value and matching profile IDs
     */
    lookupProfile(serviceSid: string, idType: string, value: string): Promise<ProfileLookupResponse>;
    /**
     * Fetch profile information with traits
     *
     * @param serviceSid - The memory service SID
     * @param profileId - The profile ID to fetch
     * @param traitGroups - Optional list of trait group names to include
     * @returns Promise containing profile response with ID, created timestamp, and traits
     */
    getProfile(serviceSid: string, profileId: string, traitGroups?: string[]): Promise<ProfileResponse>;
    /**
     * Create an observation for a profile
     *
     * @param serviceSid - The memory service SID
     * @param profileId - The profile ID to create the observation for
     * @param content - The observation content
     * @param source - Source of the observation (default: 'conversation-intelligence')
     * @param conversationIds - Optional array of conversation IDs associated with this observation
     * @param occurredAt - Optional timestamp when the observation occurred
     * @returns Promise containing the created observation
     */
    createObservation(serviceSid: string, profileId: string, content: string, source?: string, conversationIds?: string[], occurredAt?: string): Promise<CreateObservationResponse>;
    /**
     * Create conversation summaries for a profile
     *
     * @param serviceSid - The memory service SID
     * @param profileId - The profile ID to create summaries for
     * @param summaries - Array of summary items to create
     * @returns Promise containing a success message for the created conversation summaries
     */
    createConversationSummaries(serviceSid: string, profileId: string, summaries: Array<{
        content: string;
        conversationId: string;
        occurredAt: string;
        source?: string;
    }>): Promise<CreateConversationSummariesResponse>;
    /**
     * Get Basic Auth header for HTTP requests
     */
    private getBasicAuthHeader;
    /**
     * Log HTTP request details
     */
    private logRequest;
    /**
     * Log HTTP response details
     */
    private logResponse;
}

/**
 * Conversation client for interacting with Twilio Conversations Service
 *
 * Provides functionality to create conversations, add participants,
 * and manage conversation lifecycle.
 */
declare class ConversationClient {
    private readonly baseUrl;
    private readonly credentials;
    private readonly conversationServiceId;
    private readonly logger;
    constructor(config: TACConfig, logger?: Logger);
    /**
     * List communications for a conversation
     *
     * @param conversationId - The conversation ID
     * @returns Promise containing array of communications
     */
    listCommunications(conversationId: string): Promise<Communication[]>;
    /**
     * Create a new conversation
     *
     * @param name - Optional conversation name
     * @returns Promise containing conversation response
     */
    createConversation(name?: string): Promise<ConversationResponse>;
    /**
     * Add a participant to a conversation
     *
     * @param conversationId - The conversation ID
     * @param addresses - Array of participant addresses
     * @param participantType - Type of participant (CUSTOMER, AI_AGENT, HUMAN_AGENT)
     * @returns Promise containing participant response
     */
    addParticipant(conversationId: string, addresses: ConversationAddress[], participantType: 'CUSTOMER' | 'AI_AGENT' | 'HUMAN_AGENT'): Promise<ConversationParticipant>;
    /**
     * List participants in a conversation
     *
     * @param conversationId - The conversation ID
     * @returns Promise containing array of participants
     */
    listParticipants(conversationId: string): Promise<ConversationParticipant[]>;
    /**
     * List conversations with optional filters
     *
     * @param filters - Optional filters (channelId, status)
     * @returns Promise containing array of conversations
     */
    listConversations(filters?: {
        channelId?: string;
        status?: string[];
    }): Promise<ConversationResponse[]>;
    /**
     * Update conversation status
     *
     * @param conversationId - The conversation ID
     * @param status - New status (ACTIVE, INACTIVE, CLOSED)
     * @returns Promise containing updated conversation
     */
    updateConversation(conversationId: string, status: 'ACTIVE' | 'INACTIVE' | 'CLOSED'): Promise<ConversationResponse>;
    /**
     * Get Basic Auth header for HTTP requests
     */
    private getBasicAuthHeader;
    /**
     * Log HTTP request details
     */
    private logRequest;
    /**
     * Log HTTP response details
     */
    private logResponse;
}

/**
 * Knowledge client for interacting with Twilio Knowledge Service
 *
 * Provides functionality to retrieve knowledge base metadata and search
 * knowledge bases for relevant content.
 */
declare class KnowledgeClient {
    private readonly baseUrl;
    private readonly credentials;
    private readonly logger;
    constructor(config: TACConfig, logger?: Logger);
    /**
     * Get knowledge base metadata
     *
     * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
     * @returns Promise containing knowledge base metadata
     */
    getKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBase>;
    /**
     * Search knowledge base for relevant content
     *
     * @param knowledgeBaseId - The knowledge base ID (format: know_knowledgebase_*)
     * @param query - Search query (max 2048 characters)
     * @param topK - Maximum number of results to return (default: 5, max: 20)
     * @param knowledgeIds - Optional list of knowledge IDs to filter results
     * @returns Promise containing array of search result chunks
     */
    searchKnowledgeBase(knowledgeBaseId: string, query: string, topK?: number, knowledgeIds?: string[]): Promise<KnowledgeChunkResult[]>;
    /**
     * Get Basic Auth header for HTTP requests
     */
    private getBasicAuthHeader;
    /**
     * Log HTTP request details
     */
    private logRequest;
    /**
     * Log HTTP response details
     */
    private logResponse;
}

/**
 * Base channel event callbacks
 */
interface BaseChannelEvents {
    onConversationStarted?: (data: {
        session: ConversationSession;
    }) => void;
    onConversationEnded?: (data: {
        session: ConversationSession;
    }) => Promise<void> | void;
    onError?: (data: {
        error: Error;
        context?: Record<string, unknown>;
    }) => void;
}
/**
 * Abstract base class for all channel implementations
 *
 * Provides common functionality for conversation lifecycle management,
 * session tracking, and shared utilities across different channel types.
 */
declare abstract class BaseChannel {
    protected readonly tac: TAC;
    protected readonly config: TACConfig;
    protected readonly logger: Logger;
    protected readonly conversationClient: ConversationClient;
    protected readonly activeConversations: Map<ConversationId, ConversationSession>;
    protected readonly callbacks: BaseChannelEvents;
    constructor(tac: TAC);
    /**
     * Get the channel type (implemented by subclasses)
     */
    abstract get channelType(): ChannelType;
    /**
     * Register event callbacks
     */
    on(event: string, callback: (...args: any[]) => void): void;
    /**
     * Process incoming webhook data (implemented by subclasses)
     */
    abstract processWebhook(payload: unknown): Promise<void>;
    /**
     * Send a response back to the user (implemented by subclasses)
     */
    abstract sendResponse(conversationId: ConversationId, message: string, metadata?: Record<string, unknown>): Promise<void>;
    /**
     * Start a new conversation session
     */
    protected startConversation(conversationId: ConversationId, profileId?: ProfileId, serviceId?: string): ConversationSession;
    /**
     * End a conversation session.
     *
     * Triggers the onConversationEnded callback BEFORE removing the session,
     * so the callback receives the full ConversationSession data.
     * Errors in the callback do not prevent session cleanup.
     */
    protected endConversation(conversationId: ConversationId): Promise<void>;
    /**
     * Get an active conversation session
     */
    getConversationSession(conversationId: ConversationId): ConversationSession | undefined;
    /**
     * Check if a conversation is active
     */
    isConversationActive(conversationId: ConversationId): boolean;
    /**
     * Handle errors with proper context
     */
    protected handleError(error: Error, context?: Record<string, unknown>): void;
    /**
     * Validate webhook payload (override in subclasses for specific validation)
     */
    protected validateWebhookPayload(payload: unknown): boolean;
    /**
     * Extract conversation ID from webhook payload (implemented by subclasses)
     */
    protected abstract extractConversationId(payload: unknown): ConversationId | null;
    /**
     * Extract profile ID from webhook payload (implemented by subclasses)
     */
    protected abstract extractProfileId(payload: unknown): ProfileId | null;
    /**
     * Cleanup resources when shutting down
     */
    shutdown(): void;
}

interface TACOptions {
    config?: TACConfig | TACConfigData;
    logger?: Logger;
}
/**
 * Callback function signatures for TAC events
 */
type MessageReadyCallback = (params: {
    conversationId: ConversationId;
    profileId: ProfileId | undefined;
    message: string;
    author: string;
    memory: TACMemoryResponse | undefined;
    session: ConversationSession;
    channel: ChannelType;
}) => Promise<void> | void;
type InterruptCallback = (params: {
    conversationId: ConversationId;
    reason: string;
    transcript: string | undefined;
    session: ConversationSession;
}) => Promise<void> | void;
type HandoffCallback = (params: {
    conversationId: ConversationId;
    profileId: ProfileId | undefined;
    reason: string;
    session: ConversationSession;
}) => Promise<void> | void;
type ConversationEndedCallback = (params: {
    session: ConversationSession;
}) => Promise<void> | void;
/**
 * Main Twilio Agent Connect class
 *
 * Central orchestrator that manages configuration, channels, callbacks,
 * and coordinates between memory, conversations, and LLM integrations.
 */
declare class TAC {
    private readonly config;
    readonly logger: Logger;
    private readonly memoryClient?;
    private readonly knowledgeClient?;
    private readonly conversationClient;
    private readonly channels;
    private readonly cintelProcessor?;
    private messageReadyCallback?;
    private interruptCallback?;
    private handoffCallback?;
    private conversationEndedCallback?;
    constructor(options?: TACOptions);
    /**
     * Register a channel with the framework
     */
    registerChannel(channel: BaseChannel): void;
    /**
     * Set up event listeners for a channel
     */
    private setupChannelEventListeners;
    /**
     * Handle message ready event from channels
     */
    private handleMessageReady;
    /**
     * Register callback for when messages are ready to be processed
     */
    onMessageReady(callback: MessageReadyCallback): void;
    /**
     * Register callback for when user interrupts (voice channel)
     */
    onInterrupt(callback: InterruptCallback): void;
    /**
     * Register callback for human handoff
     */
    onHandoff(callback: HandoffCallback): void;
    /**
     * Register callback for when a conversation ends.
     *
     * The callback is triggered by channels when a conversation is closed
     * (e.g., SMS conversation status changed to CLOSED, or voice WebSocket
     * disconnected). The callback receives the full ConversationSession before
     * it is cleaned up.
     */
    onConversationEnded(callback: ConversationEndedCallback): void;
    /**
     * Trigger handoff callback
     */
    triggerHandoff(conversationId: ConversationId, reason: string): Promise<void>;
    /**
     * Get channel by conversation ID
     */
    private getChannelByConversationId;
    /**
     * Get registered channel by type
     */
    getChannel<T extends BaseChannel>(channelType: ChannelType): T | undefined;
    /**
     * Get configuration
     */
    getConfig(): TACConfig;
    /**
     * Get memory client for advanced memory operations
     * Returns undefined if memory credentials are not configured
     */
    getMemoryClient(): MemoryClient | undefined;
    /**
     * Get knowledge client for knowledge base operations
     * Returns undefined if memory credentials are not configured
     */
    getKnowledgeClient(): KnowledgeClient | undefined;
    /**
     * Get conversation client for advanced conversation operations
     */
    getConversationClient(): ConversationClient;
    /**
     * Check if Twilio Memory functionality is enabled
     *
     * @returns true if memory client is initialized, false otherwise
     */
    isMemoryEnabled(): boolean;
    /**
     * Check if Knowledge functionality is enabled
     *
     * @returns true if knowledge client is initialized, false otherwise
     */
    isKnowledgeEnabled(): boolean;
    /**
     * Check if Conversation Intelligence processing is enabled
     *
     * @returns true if CI processor is initialized, false otherwise
     */
    isCintelEnabled(): boolean;
    /**
     * Process a Conversation Intelligence operator result webhook event
     *
     * @param payload - The raw webhook payload from CI
     * @returns Promise containing the processing result
     * @throws Error if CI processor is not initialized
     */
    processCintelEvent(payload: unknown): Promise<OperatorProcessingResult>;
    /**
     * Retrieve memories from Memory API or fallback to Conversations API
     *
     * @param session - Conversation session context
     * @param query - Optional semantic search query
     * @returns Promise containing TACMemoryResponse wrapper providing unified access to memory data.
     *
     * When Memory is configured:
     * - observations, summaries, and communications available
     * - communications include author name and type
     *
     * When using Maestro fallback:
     * - observations and summaries are empty arrays
     * - communications have basic fields only (no author name/type)
     */
    retrieveMemory(session: ConversationSession, query?: string): Promise<TACMemoryResponse>;
    /**
     * Fetch profile information with traits
     *
     * @param profileId - Profile ID to fetch
     * @returns Promise containing profile response or undefined if not available
     */
    fetchProfile(profileId: string): Promise<ProfileResponse | undefined>;
    /**
     * Shutdown TAC and cleanup resources
     */
    shutdown(): void;
}

/**
 * TAC Tool class with helper methods for LLM integration
 *
 * Matches Python's TACTool dataclass with conversion methods.
 */
declare class TACTool<TParams = any, TResult = any> {
    readonly name: string;
    readonly description: string;
    readonly parameters: JSONSchema;
    readonly implementation: ToolFunction<TParams, TResult>;
    constructor(name: string, description: string, parameters: JSONSchema, implementation: ToolFunction<TParams, TResult>);
    /**
     * Convert to OpenAI function calling format
     */
    toOpenAIFormat(): Record<string, any>;
    /**
     * Convert to Anthropic tool calling format
     */
    toAnthropicFormat(): Record<string, any>;
    /**
     * Convert to JSON string (OpenAI format by default)
     */
    toJSON(): string;
}
/**
 * Create a tool directly with all parameters
 *
 * Simplified approach matching Python's create_tool function.
 * No builder pattern - just a simple function call.
 */
declare function defineTool<TParams = any, TResult = any>(name: string, description: string, parameters: JSONSchema, implementation: ToolFunction<TParams, TResult>): TACTool<TParams, TResult>;

/**
 * Parameters for memory retrieval tool
 */
interface MemoryRetrievalParams {
    query?: string;
    start_date?: string;
    end_date?: string;
    observation_limit?: number;
    summary_limit?: number;
    session_limit?: number;
}
/**
 * Create memory retrieval tool
 */
declare function createMemoryRetrievalTool(memoryClient: MemoryClient, serviceSid: string, profileId?: string): TACTool<MemoryRetrievalParams, MemoryRetrievalResponse>;
/**
 * Create factory function for memory tools
 */
declare function createMemoryTools(memoryClient: MemoryClient, serviceSid: string): {
    forProfile: (profileId: string) => TACTool<MemoryRetrievalParams, MemoryRetrievalResponse>;
    forSession: (profileId?: string) => TACTool<MemoryRetrievalParams, MemoryRetrievalResponse>;
};

/**
 * Parameters for send message tool
 */
interface SendMessageParams {
    message: string;
    metadata?: Record<string, unknown>;
}
/**
 * Result from send message tool
 */
interface SendMessageResult {
    success: boolean;
    message_id?: string;
    error?: string;
}
/**
 * Create send message tool
 */
declare function createSendMessageTool(channel: BaseChannel, conversationId: ConversationId): TACTool<SendMessageParams, SendMessageResult>;
/**
 * Create factory function for messaging tools
 */
declare function createMessagingTools(): {
    /**
     * Create send message tool for specific channel and conversation
     */
    forConversation: (channel: BaseChannel, conversationId: ConversationId) => TACTool<SendMessageParams, SendMessageResult>;
};

/**
 * Parameters for handoff tool
 */
interface HandoffParams {
    reason: string;
    urgency?: 'low' | 'medium' | 'high';
    context?: string;
    metadata?: Record<string, unknown>;
}
/**
 * Result from handoff tool
 */
interface HandoffResult {
    success: boolean;
    handoff_id: string;
    estimated_wait_time?: string;
    error?: string;
}
/**
 * Create human handoff tool
 */
declare function createHandoffTool(tac: TAC, conversationId: ConversationId): TACTool<HandoffParams, HandoffResult>;
/**
 * Create factory function for handoff tools
 */
declare function createHandoffTools(): {
    /**
     * Create handoff tool for specific TAC instance and conversation
     */
    forConversation: (tac: TAC, conversationId: ConversationId) => TACTool<HandoffParams, HandoffResult>;
};

/**
 * Parameters for knowledge search tool (visible to LLM)
 */
interface KnowledgeSearchParams {
    query: string;
}
/**
 * Configuration for knowledge search tool
 */
interface KnowledgeToolConfig {
    name?: string;
    description?: string;
    topK?: number;
}
/**
 * Create knowledge search tool with explicit name and description
 *
 * @param knowledgeClient - The Knowledge client instance
 * @param knowledgeBaseId - The knowledge base ID to search
 * @param config - Configuration with required name and description
 * @returns TACTool configured for knowledge search
 */
declare function createKnowledgeSearchTool(knowledgeClient: KnowledgeClient, knowledgeBaseId: string, config: {
    name: string;
    description: string;
    topK?: number;
}): TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>;
/**
 * Create knowledge search tool with auto-fetched metadata from knowledge base
 *
 * This async version fetches the knowledge base metadata to auto-generate
 * the tool name and description if not provided.
 *
 * @param knowledgeClient - The Knowledge client instance
 * @param knowledgeBaseId - The knowledge base ID to search
 * @param config - Optional configuration (name/description auto-generated if not provided)
 * @returns Promise containing TACTool configured for knowledge search
 */
declare function createKnowledgeSearchToolAsync(knowledgeClient: KnowledgeClient, knowledgeBaseId: string, config?: KnowledgeToolConfig): Promise<TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>>;
/**
 * Create factory for knowledge tools
 *
 * @param knowledgeClient - The Knowledge client instance
 * @returns Factory object with methods to create knowledge tools
 */
declare function createKnowledgeTools(knowledgeClient: KnowledgeClient): {
    forKnowledgeBase: (knowledgeBaseId: string, config: {
        name: string;
        description: string;
        topK?: number;
    }) => TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>;
    forKnowledgeBaseAsync: (knowledgeBaseId: string, config?: KnowledgeToolConfig) => Promise<TACTool<KnowledgeSearchParams, KnowledgeChunkResult[]>>;
};

export { type JSONSchema, type OpenAITool, TACTool, type ToolContext, type ToolExecutionResult, type ToolFunction, createHandoffTool, createHandoffTools, createKnowledgeSearchTool, createKnowledgeSearchToolAsync, createKnowledgeTools, createMemoryRetrievalTool, createMemoryTools, createMessagingTools, createSendMessageTool, defineTool };

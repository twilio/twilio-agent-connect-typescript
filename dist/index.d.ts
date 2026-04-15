import { z } from 'zod';
export { z } from 'zod';
import pino from 'pino';
import { WebSocket } from 'ws';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js';
import { FastifyServerOptions } from 'fastify';

/**
 * Channel types supported by the framework
 */
declare const ChannelTypeSchema: z.ZodEnum<["sms", "voice", "chat"]>;
type ChannelType = z.infer<typeof ChannelTypeSchema>;
/**
 * TAC Configuration schema with environment-aware URL computation
 */
declare const TACConfigSchema: z.ZodObject<{
    twilioAccountSid: z.ZodString;
    twilioAuthToken: z.ZodString;
    twilioApiKey: z.ZodString;
    twilioApiToken: z.ZodString;
    twilioPhoneNumber: z.ZodString;
    memoryStoreId: z.ZodOptional<z.ZodString>;
    traitGroups: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    conversationServiceId: z.ZodString;
    voicePublicDomain: z.ZodOptional<z.ZodString>;
    cintelConfigurationId: z.ZodOptional<z.ZodString>;
    cintelObservationOperatorSid: z.ZodOptional<z.ZodString>;
    cintelSummaryOperatorSid: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    twilioAccountSid: string;
    twilioAuthToken: string;
    twilioApiKey: string;
    twilioApiToken: string;
    twilioPhoneNumber: string;
    conversationServiceId: string;
    memoryStoreId?: string | undefined;
    traitGroups?: string[] | undefined;
    voicePublicDomain?: string | undefined;
    cintelConfigurationId?: string | undefined;
    cintelObservationOperatorSid?: string | undefined;
    cintelSummaryOperatorSid?: string | undefined;
}, {
    twilioAccountSid: string;
    twilioAuthToken: string;
    twilioApiKey: string;
    twilioApiToken: string;
    twilioPhoneNumber: string;
    conversationServiceId: string;
    memoryStoreId?: string | undefined;
    traitGroups?: string[] | undefined;
    voicePublicDomain?: string | undefined;
    cintelConfigurationId?: string | undefined;
    cintelObservationOperatorSid?: string | undefined;
    cintelSummaryOperatorSid?: string | undefined;
}>;
type TACConfigData = z.infer<typeof TACConfigSchema>;
/**
 * Environment variable mapping for configuration
 */
declare const EnvironmentVariables: {
    readonly TWILIO_ACCOUNT_SID: "TWILIO_ACCOUNT_SID";
    readonly TWILIO_AUTH_TOKEN: "TWILIO_AUTH_TOKEN";
    readonly TWILIO_API_KEY: "TWILIO_API_KEY";
    readonly TWILIO_API_TOKEN: "TWILIO_API_TOKEN";
    readonly TWILIO_PHONE_NUMBER: "TWILIO_PHONE_NUMBER";
    readonly MEMORY_STORE_ID: "MEMORY_STORE_ID";
    readonly TRAIT_GROUPS: "TRAIT_GROUPS";
    readonly CONVERSATION_SERVICE_ID: "CONVERSATION_SERVICE_ID";
    readonly VOICE_PUBLIC_DOMAIN: "VOICE_PUBLIC_DOMAIN";
    readonly TWILIO_TAC_CI_CONFIGURATION_ID: "TWILIO_TAC_CI_CONFIGURATION_ID";
    readonly TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID: "TWILIO_TAC_CI_OBSERVATION_OPERATOR_SID";
    readonly TWILIO_TAC_CI_SUMMARY_OPERATOR_SID: "TWILIO_TAC_CI_SUMMARY_OPERATOR_SID";
};
/**
 * Server configuration for built-in Fastify setup
 */
declare const VoiceServerConfigSchema: z.ZodObject<{
    host: z.ZodDefault<z.ZodString>;
    port: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    host: string;
    port: number;
}, {
    host?: string | undefined;
    port?: number | undefined;
}>;
type VoiceServerConfig = z.infer<typeof VoiceServerConfigSchema>;

/**
 * Message direction in a conversation
 */
declare const MessageDirectionSchema: z.ZodEnum<["inbound", "outbound"]>;
type MessageDirection = z.infer<typeof MessageDirectionSchema>;
/**
 * Channel type for Memory communications
 */
declare const MemoryChannelTypeSchema: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
type MemoryChannelType = z.infer<typeof MemoryChannelTypeSchema>;
/**
 * Participant type in Memory API
 */
declare const MemoryParticipantTypeSchema: z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]>;
type MemoryParticipantType = z.infer<typeof MemoryParticipantTypeSchema>;
/**
 * Delivery status for Memory communications
 */
declare const MemoryDeliveryStatusSchema: z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>;
type MemoryDeliveryStatus = z.infer<typeof MemoryDeliveryStatusSchema>;
/**
 * Participant in a Memory communication (author or recipient).
 *
 * Memory API has different field requirements than Maestro:
 * - Uses `id` and `name` instead of just `participant_id`
 * - Includes `type` and `profile_id` fields
 */
declare const MemoryParticipantSchema: z.ZodObject<{
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
type MemoryParticipant = z.infer<typeof MemoryParticipantSchema>;
/**
 * Content of a Memory communication.
 *
 * Memory API content is simpler than Maestro - no type discriminator field.
 * The `text` field is optional in Memory API models.
 */
declare const MemoryCommunicationContentSchema: z.ZodObject<{
    text: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    text?: string | undefined;
}, {
    text?: string | undefined;
}>;
type MemoryCommunicationContent = z.infer<typeof MemoryCommunicationContentSchema>;
/**
 * A communication from Memory API (historical conversation data).
 *
 * Memory API has different field requirements than Maestro:
 * - No `conversation_id`, `account_id`, or `content.type` fields
 * - Participants use `id`, `name`, `type`, `profile_id`
 */
declare const MemoryCommunicationSchema: z.ZodObject<{
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
}>;
type MemoryCommunication = z.infer<typeof MemoryCommunicationSchema>;
/**
 * Individual session message
 */
declare const SessionMessageSchema: z.ZodObject<{
    direction: z.ZodEnum<["inbound", "outbound"]>;
    channel: z.ZodString;
    from_address: z.ZodOptional<z.ZodString>;
    to_address: z.ZodOptional<z.ZodString>;
    content: z.ZodString;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    channel: string;
    content: string;
    direction: "inbound" | "outbound";
    timestamp: string;
    from_address?: string | undefined;
    to_address?: string | undefined;
}, {
    channel: string;
    content: string;
    direction: "inbound" | "outbound";
    timestamp: string;
    from_address?: string | undefined;
    to_address?: string | undefined;
}>;
type SessionMessage = z.infer<typeof SessionMessageSchema>;
/**
 * Session information containing conversation history
 */
declare const SessionInfoSchema: z.ZodObject<{
    session_id: z.ZodString;
    started_at: z.ZodString;
    ended_at: z.ZodOptional<z.ZodString>;
    channel: z.ZodString;
    messages: z.ZodArray<z.ZodObject<{
        direction: z.ZodEnum<["inbound", "outbound"]>;
        channel: z.ZodString;
        from_address: z.ZodOptional<z.ZodString>;
        to_address: z.ZodOptional<z.ZodString>;
        content: z.ZodString;
        timestamp: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        channel: string;
        content: string;
        direction: "inbound" | "outbound";
        timestamp: string;
        from_address?: string | undefined;
        to_address?: string | undefined;
    }, {
        channel: string;
        content: string;
        direction: "inbound" | "outbound";
        timestamp: string;
        from_address?: string | undefined;
        to_address?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    channel: string;
    session_id: string;
    started_at: string;
    messages: {
        channel: string;
        content: string;
        direction: "inbound" | "outbound";
        timestamp: string;
        from_address?: string | undefined;
        to_address?: string | undefined;
    }[];
    ended_at?: string | undefined;
}, {
    channel: string;
    session_id: string;
    started_at: string;
    messages: {
        channel: string;
        content: string;
        direction: "inbound" | "outbound";
        timestamp: string;
        from_address?: string | undefined;
        to_address?: string | undefined;
    }[];
    ended_at?: string | undefined;
}>;
type SessionInfo = z.infer<typeof SessionInfoSchema>;
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
    profiles: z.ZodEffects<z.ZodNullable<z.ZodArray<z.ZodString, "many">>, string[], string[] | null>;
}, "strip", z.ZodTypeAny, {
    normalizedValue: string;
    profiles: string[];
}, {
    normalizedValue: string;
    profiles: string[] | null;
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
 * Empty memory response for error fallback
 */
declare const EMPTY_MEMORY_RESPONSE: MemoryRetrievalResponse;
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
 * Participant address type for different communication channels
 */
declare const ParticipantAddressTypeSchema: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
type ParticipantAddressType = z.infer<typeof ParticipantAddressTypeSchema>;
/**
 * Participant address containing channel and address
 */
declare const ParticipantAddressSchema: z.ZodObject<{
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
type ParticipantAddress = z.infer<typeof ParticipantAddressSchema>;
/**
 * Communication participant for Conversations Service API (Maestro).
 *
 * Note: participantId is required for SDK validation when creating communications.
 */
declare const CommunicationParticipantSchema: z.ZodObject<{
    address: z.ZodString;
    channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
    participantId: z.ZodString;
    deliveryStatus: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
}, "strip", z.ZodTypeAny, {
    address: string;
    channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
    participantId: string;
    deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
}, {
    address: string;
    channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
    participantId: string;
    deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
}>;
type CommunicationParticipant = z.infer<typeof CommunicationParticipantSchema>;
/**
 * Word-level transcription data with timing information.
 */
declare const TranscriptionWordSchema: z.ZodObject<{
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
}>;
type TranscriptionWord = z.infer<typeof TranscriptionWordSchema>;
/**
 * Transcription metadata for communication content.
 */
declare const TranscriptionSchema: z.ZodObject<{
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
}>;
type Transcription = z.infer<typeof TranscriptionSchema>;
/**
 * Communication content (ContentText or ContentTranscription).
 *
 * Note: In Maestro API, both `type` and `text` are required fields.
 */
declare const CommunicationContentSchema: z.ZodObject<{
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
type CommunicationContent = z.infer<typeof CommunicationContentSchema>;
/**
 * Communication from Conversations Service API (Maestro).
 *
 * Note: `createdAt` is optional per API spec.
 */
declare const CommunicationSchema: z.ZodObject<{
    id: z.ZodString;
    conversationId: z.ZodString;
    accountId: z.ZodString;
    author: z.ZodObject<{
        address: z.ZodString;
        channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
        participantId: z.ZodString;
        deliveryStatus: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId: string;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId: string;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
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
        participantId: z.ZodString;
        deliveryStatus: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId: string;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId: string;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }>, "many">;
    channelId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    createdAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updatedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    occurredAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    author: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId: string;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
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
        participantId: string;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }[];
    conversationId: string;
    accountId: string;
    createdAt?: string | null | undefined;
    occurredAt?: string | null | undefined;
    updatedAt?: string | null | undefined;
    channelId?: string | null | undefined;
}, {
    id: string;
    author: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId: string;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
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
        participantId: string;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    }[];
    conversationId: string;
    accountId: string;
    createdAt?: string | null | undefined;
    occurredAt?: string | null | undefined;
    updatedAt?: string | null | undefined;
    channelId?: string | null | undefined;
}>;
type Communication = z.infer<typeof CommunicationSchema>;
/**
 * Send API author/recipient address (ParticipantAddress)
 */
declare const SendCommunicationParticipantAddressSchema: z.ZodObject<{
    address: z.ZodString;
    channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
    participantId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    address: string;
    channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
    participantId?: string | undefined;
}, {
    address: string;
    channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
    participantId?: string | undefined;
}>;
type SendCommunicationParticipantAddress = z.infer<typeof SendCommunicationParticipantAddressSchema>;
/**
 * Send API request fields for POST /v2/Communications.
 * Note: conversationId is supplied separately as a parameter to sendCommunication()
 * and merged into the JSON payload by the client before sending.
 */
declare const SendCommunicationRequestSchema: z.ZodObject<{
    author: z.ZodObject<{
        address: z.ZodString;
        channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
        participantId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId?: string | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId?: string | undefined;
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
        participantId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId?: string | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId?: string | undefined;
    }>, "many">;
    channelId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    author: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId?: string | undefined;
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
        participantId?: string | undefined;
    }[];
    channelId?: string | undefined;
}, {
    author: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        participantId?: string | undefined;
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
        participantId?: string | undefined;
    }[];
    channelId?: string | undefined;
}>;
type SendCommunicationRequest = z.infer<typeof SendCommunicationRequestSchema>;
/**
 * Send API response from POST /v2/Communications endpoint
 * Returns 202 Accepted with async job status.
 * The Communication record is created asynchronously after message delivery.
 * Listen for COMMUNICATION_CREATED webhook to get the full Communication.
 */
declare const SendCommunicationResponseSchema: z.ZodObject<{
    message: z.ZodString;
    conversationId: z.ZodString;
    channelId: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    message: string;
    channelId: string | null;
    conversationId: string;
}, {
    message: string;
    channelId: string | null;
    conversationId: string;
}>;
type SendCommunicationResponse = z.infer<typeof SendCommunicationResponseSchema>;
/**
 * Author information for a conversation session
 */
declare const AuthorInfoSchema: z.ZodObject<{
    address: z.ZodString;
    participantId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    address: string;
    participantId?: string | undefined;
}, {
    address: string;
    participantId?: string | undefined;
}>;
type AuthorInfo = z.infer<typeof AuthorInfoSchema>;
/**
 * Profile information for a conversation participant
 */
interface Profile {
    profileId: string;
    traits?: Record<string, unknown>;
}
/**
 * Conversation session context
 */
declare const ConversationSessionSchema: z.ZodObject<{
    conversationId: z.ZodString;
    profileId: z.ZodOptional<z.ZodString>;
    serviceId: z.ZodOptional<z.ZodString>;
    channel: z.ZodEnum<["sms", "voice", "chat"]>;
    startedAt: z.ZodDate;
    authorInfo: z.ZodOptional<z.ZodObject<{
        address: z.ZodString;
        participantId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        participantId?: string | undefined;
    }, {
        address: string;
        participantId?: string | undefined;
    }>>;
    profile: z.ZodOptional<z.ZodType<Profile, z.ZodTypeDef, Profile>>;
    metadata: z.ZodDefault<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, "strip", z.ZodTypeAny, {
    channel: "sms" | "voice" | "chat";
    conversationId: string;
    startedAt: Date;
    metadata: Record<string, unknown>;
    profileId?: string | undefined;
    serviceId?: string | undefined;
    authorInfo?: {
        address: string;
        participantId?: string | undefined;
    } | undefined;
    profile?: Profile | undefined;
}, {
    channel: "sms" | "voice" | "chat";
    conversationId: string;
    startedAt: Date;
    profileId?: string | undefined;
    serviceId?: string | undefined;
    authorInfo?: {
        address: string;
        participantId?: string | undefined;
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
type ParticipantId = string & {
    readonly _brand: 'ParticipantId';
};
/**
 * Type guards for branded types
 */
declare function isConversationId(value: string): value is ConversationId;
declare function isProfileId(value: string): value is ProfileId;
declare function isParticipantId(value: string): value is ParticipantId;
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
    type: z.ZodOptional<z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT", "AGENT", "UNKNOWN"]>>;
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
    conversationId: string;
    accountId: string;
    addresses: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        channelId?: string | null | undefined;
    }[];
    type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | "AGENT" | "UNKNOWN" | undefined;
    name?: string | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
    profileId?: string | null | undefined;
}, {
    id: string;
    conversationId: string;
    accountId: string;
    type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | "AGENT" | "UNKNOWN" | undefined;
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
 * Timeout settings for channel status transitions
 */
declare const StatusTimeoutsSchema: z.ZodObject<{
    inactive: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    closed: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    closed: number;
    inactive?: number | null | undefined;
}, {
    closed: number;
    inactive?: number | null | undefined;
}>;
type StatusTimeouts = z.infer<typeof StatusTimeoutsSchema>;
/**
 * Capture rule with from/to addresses and optional metadata
 */
declare const CaptureRuleSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodString>>>;
}, "strip", z.ZodTypeAny, {
    from: string;
    to: string;
    metadata?: Record<string, string> | null | undefined;
}, {
    from: string;
    to: string;
    metadata?: Record<string, string> | null | undefined;
}>;
type CaptureRule = z.infer<typeof CaptureRuleSchema>;
/**
 * Configuration settings for a specific channel type
 */
declare const ChannelSettingsSchema: z.ZodObject<{
    statusTimeouts: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        inactive: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        closed: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        closed: number;
        inactive?: number | null | undefined;
    }, {
        closed: number;
        inactive?: number | null | undefined;
    }>>>;
    captureRules: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
        metadata: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodString>>>;
    }, "strip", z.ZodTypeAny, {
        from: string;
        to: string;
        metadata?: Record<string, string> | null | undefined;
    }, {
        from: string;
        to: string;
        metadata?: Record<string, string> | null | undefined;
    }>, "many">>>;
}, "strip", z.ZodTypeAny, {
    statusTimeouts?: {
        closed: number;
        inactive?: number | null | undefined;
    } | null | undefined;
    captureRules?: {
        from: string;
        to: string;
        metadata?: Record<string, string> | null | undefined;
    }[] | null | undefined;
}, {
    statusTimeouts?: {
        closed: number;
        inactive?: number | null | undefined;
    } | null | undefined;
    captureRules?: {
        from: string;
        to: string;
        metadata?: Record<string, string> | null | undefined;
    }[] | null | undefined;
}>;
type ChannelSettings = z.infer<typeof ChannelSettingsSchema>;
/**
 * Webhook configuration for status callbacks
 */
declare const StatusCallbackSchema: z.ZodObject<{
    url: z.ZodString;
    method: z.ZodDefault<z.ZodOptional<z.ZodEnum<["POST", "GET", "PUT", "DELETE", "PATCH"]>>>;
}, "strip", z.ZodTypeAny, {
    url: string;
    method: "POST" | "GET" | "PUT" | "DELETE" | "PATCH";
}, {
    url: string;
    method?: "POST" | "GET" | "PUT" | "DELETE" | "PATCH" | undefined;
}>;
type StatusCallback = z.infer<typeof StatusCallbackSchema>;
/**
 * Conversation grouping type
 */
declare const ConversationGroupingTypeSchema: z.ZodEnum<["GROUP_BY_PARTICIPANT_ADDRESSES", "GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE"]>;
type ConversationGroupingType = z.infer<typeof ConversationGroupingTypeSchema>;
/**
 * Configuration settings for a conversation
 */
declare const ConversationConfigurationSchema: z.ZodObject<{
    id: z.ZodString;
    displayName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    description: z.ZodString;
    conversationGroupingType: z.ZodEnum<["GROUP_BY_PARTICIPANT_ADDRESSES", "GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE"]>;
    memoryStoreId: z.ZodString;
    channelSettings: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodObject<{
        statusTimeouts: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            inactive: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            closed: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            closed: number;
            inactive?: number | null | undefined;
        }, {
            closed: number;
            inactive?: number | null | undefined;
        }>>>;
        captureRules: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
            from: z.ZodString;
            to: z.ZodString;
            metadata: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodString>>>;
        }, "strip", z.ZodTypeAny, {
            from: string;
            to: string;
            metadata?: Record<string, string> | null | undefined;
        }, {
            from: string;
            to: string;
            metadata?: Record<string, string> | null | undefined;
        }>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        statusTimeouts?: {
            closed: number;
            inactive?: number | null | undefined;
        } | null | undefined;
        captureRules?: {
            from: string;
            to: string;
            metadata?: Record<string, string> | null | undefined;
        }[] | null | undefined;
    }, {
        statusTimeouts?: {
            closed: number;
            inactive?: number | null | undefined;
        } | null | undefined;
        captureRules?: {
            from: string;
            to: string;
            metadata?: Record<string, string> | null | undefined;
        }[] | null | undefined;
    }>>>>;
    statusCallbacks: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        url: z.ZodString;
        method: z.ZodDefault<z.ZodOptional<z.ZodEnum<["POST", "GET", "PUT", "DELETE", "PATCH"]>>>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        method: "POST" | "GET" | "PUT" | "DELETE" | "PATCH";
    }, {
        url: string;
        method?: "POST" | "GET" | "PUT" | "DELETE" | "PATCH" | undefined;
    }>, "many">>>;
    intelligenceConfigurationIds: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    createdAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    updatedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    version: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    memoryStoreId: string;
    id: string;
    description: string;
    conversationGroupingType: "GROUP_BY_PARTICIPANT_ADDRESSES" | "GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE";
    createdAt?: string | null | undefined;
    updatedAt?: string | null | undefined;
    displayName?: string | null | undefined;
    channelSettings?: Record<string, {
        statusTimeouts?: {
            closed: number;
            inactive?: number | null | undefined;
        } | null | undefined;
        captureRules?: {
            from: string;
            to: string;
            metadata?: Record<string, string> | null | undefined;
        }[] | null | undefined;
    }> | null | undefined;
    statusCallbacks?: {
        url: string;
        method: "POST" | "GET" | "PUT" | "DELETE" | "PATCH";
    }[] | null | undefined;
    intelligenceConfigurationIds?: string[] | null | undefined;
    version?: number | null | undefined;
}, {
    memoryStoreId: string;
    id: string;
    description: string;
    conversationGroupingType: "GROUP_BY_PARTICIPANT_ADDRESSES" | "GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE";
    createdAt?: string | null | undefined;
    updatedAt?: string | null | undefined;
    displayName?: string | null | undefined;
    channelSettings?: Record<string, {
        statusTimeouts?: {
            closed: number;
            inactive?: number | null | undefined;
        } | null | undefined;
        captureRules?: {
            from: string;
            to: string;
            metadata?: Record<string, string> | null | undefined;
        }[] | null | undefined;
    }> | null | undefined;
    statusCallbacks?: {
        url: string;
        method?: "POST" | "GET" | "PUT" | "DELETE" | "PATCH" | undefined;
    }[] | null | undefined;
    intelligenceConfigurationIds?: string[] | null | undefined;
    version?: number | null | undefined;
}>;
type ConversationConfiguration = z.infer<typeof ConversationConfigurationSchema>;

/**
 * ConversationRelay API Types
 *
 * Zod schemas are the single source of truth for runtime validation. Types are
 * inferred from schemas via z.infer. Compile-time drift guards (type assertions
 * against VoiceResponse.ConversationRelayAttributes / LanguageAttributes) ensure
 * that if the Twilio SDK types change, `npm run typecheck` will fail immediately.
 *
 * @see https://www.twilio.com/docs/voice/conversationrelay
 * @see https://www.twilio.com/docs/voice/conversationrelay/conversationrelay-noun
 */
/**
 * Language configuration for multi-language ConversationRelay support
 * @see https://www.twilio.com/docs/voice/conversationrelay/conversationrelay-noun#language-attributes
 */
declare const LanguageAttributesSchema: z.ZodObject<{
    /** Language code (e.g., 'en-US', 'es-ES', 'en-AU') */
    code: z.ZodString;
    /** TTS provider for this language */
    ttsProvider: z.ZodOptional<z.ZodString>;
    /** TTS voice for this language */
    voice: z.ZodOptional<z.ZodString>;
    /** TTS language (may differ from code) */
    ttsLanguage: z.ZodOptional<z.ZodString>;
    /** Transcription provider for this language */
    transcriptionProvider: z.ZodOptional<z.ZodString>;
    /** Speech model for transcription */
    speechModel: z.ZodOptional<z.ZodString>;
    /** Transcription language (may differ from code) */
    transcriptionLanguage: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    code: string;
    voice?: string | undefined;
    ttsProvider?: string | undefined;
    ttsLanguage?: string | undefined;
    transcriptionProvider?: string | undefined;
    speechModel?: string | undefined;
    transcriptionLanguage?: string | undefined;
}, {
    code: string;
    voice?: string | undefined;
    ttsProvider?: string | undefined;
    ttsLanguage?: string | undefined;
    transcriptionProvider?: string | undefined;
    speechModel?: string | undefined;
    transcriptionLanguage?: string | undefined;
}>;
type LanguageAttributes = z.infer<typeof LanguageAttributesSchema>;
/**
 * ConversationRelay attributes for TwiML configuration
 * @see https://www.twilio.com/docs/voice/conversationrelay/conversationrelay-noun
 */
declare const ConversationRelayAttributesSchema: z.ZodObject<{
    /** WebSocket URL for ConversationRelay (required) */
    url: z.ZodString;
    /** Initial greeting to play when call connects */
    welcomeGreeting: z.ZodOptional<z.ZodString>;
    /** Whether welcome greeting can be interrupted */
    welcomeGreetingInterruptible: z.ZodOptional<z.ZodEnum<["any", "speech", "none"]>>;
    /** Transcription provider (e.g., 'Deepgram', 'Google') */
    transcriptionProvider: z.ZodOptional<z.ZodString>;
    /** Language for transcription (e.g., 'en-US') */
    transcriptionLanguage: z.ZodOptional<z.ZodString>;
    /** Speech model for transcription (e.g., 'nova-3-general') */
    speechModel: z.ZodOptional<z.ZodString>;
    /** Text-to-speech provider (e.g., 'Google', 'ElevenLabs') */
    ttsProvider: z.ZodOptional<z.ZodString>;
    /** Language for TTS (e.g., 'en-US') */
    ttsLanguage: z.ZodOptional<z.ZodString>;
    /** Voice identifier for TTS (e.g., 'en-US-Journey-O') */
    voice: z.ZodOptional<z.ZodString>;
    /** ElevenLabs text normalization setting */
    elevenlabsTextNormalization: z.ZodOptional<z.ZodString>;
    /** When agent speech can be interrupted */
    interruptible: z.ZodOptional<z.ZodEnum<["any", "speech", "none"]>>;
    /** Interrupt detection sensitivity */
    interruptSensitivity: z.ZodOptional<z.ZodEnum<["low", "medium", "high"]>>;
    /** Enable DTMF tone detection */
    dtmfDetection: z.ZodOptional<z.ZodBoolean>;
    /** Recognition hints for domain-specific vocabulary */
    hints: z.ZodOptional<z.ZodString>;
    /** Whether prompts should be reported when TTS is playing and interrupt is disabled */
    reportInputDuringAgentSpeech: z.ZodOptional<z.ZodBoolean>;
    /** Enable partial prompts (streaming) */
    partialPrompts: z.ZodOptional<z.ZodBoolean>;
    /** Enable profanity filtering */
    profanityFilter: z.ZodOptional<z.ZodBoolean>;
    /** Allow preemption of agent speech */
    preemptible: z.ZodOptional<z.ZodBoolean>;
    /** Default language code */
    language: z.ZodOptional<z.ZodString>;
    /** Debug options for troubleshooting (string per SDK, not boolean) */
    debug: z.ZodOptional<z.ZodString>;
    /** Conversational Intelligence Service ID or unique name */
    intelligenceService: z.ZodOptional<z.ZodString>;
    /** Twilio Conversation Orchestrator configuration ID */
    conversationConfiguration: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    url: string;
    voice?: string | undefined;
    ttsProvider?: string | undefined;
    ttsLanguage?: string | undefined;
    transcriptionProvider?: string | undefined;
    speechModel?: string | undefined;
    transcriptionLanguage?: string | undefined;
    welcomeGreeting?: string | undefined;
    welcomeGreetingInterruptible?: "any" | "speech" | "none" | undefined;
    elevenlabsTextNormalization?: string | undefined;
    interruptible?: "any" | "speech" | "none" | undefined;
    interruptSensitivity?: "low" | "medium" | "high" | undefined;
    dtmfDetection?: boolean | undefined;
    hints?: string | undefined;
    reportInputDuringAgentSpeech?: boolean | undefined;
    partialPrompts?: boolean | undefined;
    profanityFilter?: boolean | undefined;
    preemptible?: boolean | undefined;
    language?: string | undefined;
    debug?: string | undefined;
    intelligenceService?: string | undefined;
    conversationConfiguration?: string | undefined;
}, {
    url: string;
    voice?: string | undefined;
    ttsProvider?: string | undefined;
    ttsLanguage?: string | undefined;
    transcriptionProvider?: string | undefined;
    speechModel?: string | undefined;
    transcriptionLanguage?: string | undefined;
    welcomeGreeting?: string | undefined;
    welcomeGreetingInterruptible?: "any" | "speech" | "none" | undefined;
    elevenlabsTextNormalization?: string | undefined;
    interruptible?: "any" | "speech" | "none" | undefined;
    interruptSensitivity?: "low" | "medium" | "high" | undefined;
    dtmfDetection?: boolean | undefined;
    hints?: string | undefined;
    reportInputDuringAgentSpeech?: boolean | undefined;
    partialPrompts?: boolean | undefined;
    profanityFilter?: boolean | undefined;
    preemptible?: boolean | undefined;
    language?: string | undefined;
    debug?: string | undefined;
    intelligenceService?: string | undefined;
    conversationConfiguration?: string | undefined;
}>;
type ConversationRelayAttributes = z.infer<typeof ConversationRelayAttributesSchema>;
/**
 * @internal Compile-time SDK drift guards — do not use directly.
 * If the Twilio SDK updates VoiceResponse.ConversationRelayAttributes or
 * VoiceResponse.LanguageAttributes, these checks will fail during typecheck,
 * signaling that our Zod schemas need to be updated to match.
 */
type _SDKDriftGuards = {
    langCompat: LanguageAttributes extends VoiceResponse.LanguageAttributes ? true : never;
    langKeys: keyof VoiceResponse.LanguageAttributes extends keyof LanguageAttributes ? true : never;
    crelayCompat: ConversationRelayAttributes extends VoiceResponse.ConversationRelayAttributes ? true : never;
    crelayKeys: keyof VoiceResponse.ConversationRelayAttributes extends keyof ConversationRelayAttributes ? true : never;
};
/**
 * Custom parameters passed via TwiML
 * Can contain any key-value pairs with unknown values
 */
declare const CustomParametersSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
type CustomParameters = z.infer<typeof CustomParametersSchema>;
/**
 * WebSocket setup message from ConversationRelay
 */
declare const SetupMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"setup">;
    sessionId: z.ZodString;
    callSid: z.ZodString;
    parentCallSid: z.ZodOptional<z.ZodString>;
    from: z.ZodString;
    to: z.ZodString;
    forwardedFrom: z.ZodOptional<z.ZodString>;
    callerName: z.ZodOptional<z.ZodString>;
    direction: z.ZodString;
    callType: z.ZodString;
    callStatus: z.ZodString;
    accountSid: z.ZodString;
    customParameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: "setup";
    direction: string;
    from: string;
    to: string;
    sessionId: string;
    callSid: string;
    callType: string;
    callStatus: string;
    accountSid: string;
    parentCallSid?: string | undefined;
    forwardedFrom?: string | undefined;
    callerName?: string | undefined;
    customParameters?: Record<string, unknown> | undefined;
}, {
    type: "setup";
    direction: string;
    from: string;
    to: string;
    sessionId: string;
    callSid: string;
    callType: string;
    callStatus: string;
    accountSid: string;
    parentCallSid?: string | undefined;
    forwardedFrom?: string | undefined;
    callerName?: string | undefined;
    customParameters?: Record<string, unknown> | undefined;
}>;
type SetupMessage = z.infer<typeof SetupMessageSchema>;
/**
 * WebSocket prompt message (user speech)
 */
declare const PromptMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"prompt">;
    voicePrompt: z.ZodString;
    lang: z.ZodOptional<z.ZodString>;
    last: z.ZodOptional<z.ZodBoolean>;
    agentSpeaking: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "prompt";
    voicePrompt: string;
    lang?: string | undefined;
    last?: boolean | undefined;
    agentSpeaking?: string | undefined;
}, {
    type: "prompt";
    voicePrompt: string;
    lang?: string | undefined;
    last?: boolean | undefined;
    agentSpeaking?: string | undefined;
}>;
type PromptMessage = z.infer<typeof PromptMessageSchema>;
/**
 * WebSocket interrupt message (user interruption)
 */
declare const InterruptMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"interrupt">;
    reason: z.ZodOptional<z.ZodString>;
    transcript: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "interrupt";
    reason?: string | undefined;
    transcript?: string | undefined;
}, {
    type: "interrupt";
    reason?: string | undefined;
    transcript?: string | undefined;
}>;
type InterruptMessage = z.infer<typeof InterruptMessageSchema>;
/**
 * Union of all WebSocket message types
 */
declare const WebSocketMessageSchema: z.ZodUnion<[z.ZodObject<{
    type: z.ZodLiteral<"setup">;
    sessionId: z.ZodString;
    callSid: z.ZodString;
    parentCallSid: z.ZodOptional<z.ZodString>;
    from: z.ZodString;
    to: z.ZodString;
    forwardedFrom: z.ZodOptional<z.ZodString>;
    callerName: z.ZodOptional<z.ZodString>;
    direction: z.ZodString;
    callType: z.ZodString;
    callStatus: z.ZodString;
    accountSid: z.ZodString;
    customParameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    type: "setup";
    direction: string;
    from: string;
    to: string;
    sessionId: string;
    callSid: string;
    callType: string;
    callStatus: string;
    accountSid: string;
    parentCallSid?: string | undefined;
    forwardedFrom?: string | undefined;
    callerName?: string | undefined;
    customParameters?: Record<string, unknown> | undefined;
}, {
    type: "setup";
    direction: string;
    from: string;
    to: string;
    sessionId: string;
    callSid: string;
    callType: string;
    callStatus: string;
    accountSid: string;
    parentCallSid?: string | undefined;
    forwardedFrom?: string | undefined;
    callerName?: string | undefined;
    customParameters?: Record<string, unknown> | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"prompt">;
    voicePrompt: z.ZodString;
    lang: z.ZodOptional<z.ZodString>;
    last: z.ZodOptional<z.ZodBoolean>;
    agentSpeaking: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "prompt";
    voicePrompt: string;
    lang?: string | undefined;
    last?: boolean | undefined;
    agentSpeaking?: string | undefined;
}, {
    type: "prompt";
    voicePrompt: string;
    lang?: string | undefined;
    last?: boolean | undefined;
    agentSpeaking?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"interrupt">;
    reason: z.ZodOptional<z.ZodString>;
    transcript: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "interrupt";
    reason?: string | undefined;
    transcript?: string | undefined;
}, {
    type: "interrupt";
    reason?: string | undefined;
    transcript?: string | undefined;
}>]>;
type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;
/**
 * Text Token Message to send back via WebSocket
 * @see https://www.twilio.com/docs/voice/conversationrelay/websocket-messages#text-tokens-message
 */
declare const TextTokenMessageSchema: z.ZodObject<{
    type: z.ZodLiteral<"text">;
    token: z.ZodString;
    last: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    type: "text";
    last: boolean;
    token: string;
}, {
    type: "text";
    token: string;
    last?: boolean | undefined;
}>;
type TextTokenMessage = z.infer<typeof TextTokenMessageSchema>;
/**
 * Extended ConversationRelay configuration that includes child elements.
 * Includes all ConversationRelayAttributes fields plus support for languages array.
 *
 * Note: The type is defined as an explicit interface and the schema is annotated
 * with z.ZodType<ConversationRelayConfig> to prevent TypeScript's type inference
 * from collapsing to `any` when resolving complex Zod generics with many optional
 * fields (especially under exactOptionalPropertyTypes).
 */
interface ConversationRelayConfig extends ConversationRelayAttributes {
    /** Optional language configurations as child <Language> elements */
    languages?: LanguageAttributes[] | undefined;
}
declare const ConversationRelayConfigSchema: z.ZodType<ConversationRelayConfig>;
/**
 * ConversationRelay callback payload from Twilio webhook
 *
 * Sent when a ConversationRelay session ends or transitions state.
 * Includes standard voice webhook parameters plus ConversationRelay-specific fields.
 *
 * @see https://www.twilio.com/docs/voice/twiml#request-parameters
 * @see https://www.twilio.com/docs/voice/conversationrelay/conversationrelay-noun#statuscallback
 */
declare const ConversationRelayCallbackPayloadSchema: z.ZodObject<{
    AccountSid: z.ZodString;
    CallSid: z.ZodString;
    /** Call status with strict type checking for all valid Twilio call states */
    CallStatus: z.ZodEnum<["queued", "initiated", "ringing", "in-progress", "completed", "busy", "no-answer", "failed", "canceled"]>;
    From: z.ZodString;
    To: z.ZodString;
    /** Direction of the call */
    Direction: z.ZodEnum<["inbound", "outbound-api", "outbound-dial"]>;
    ApiVersion: z.ZodOptional<z.ZodString>;
    ForwardedFrom: z.ZodOptional<z.ZodString>;
    CallerName: z.ZodOptional<z.ZodString>;
    ParentCallSid: z.ZodOptional<z.ZodString>;
    ApplicationSid: z.ZodOptional<z.ZodString>;
    SessionId: z.ZodOptional<z.ZodString>;
    SessionStatus: z.ZodOptional<z.ZodString>;
    SessionDuration: z.ZodOptional<z.ZodString>;
    HandoffData: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    AccountSid: string;
    CallSid: string;
    CallStatus: "queued" | "initiated" | "ringing" | "in-progress" | "completed" | "busy" | "no-answer" | "failed" | "canceled";
    From: string;
    To: string;
    Direction: "inbound" | "outbound-api" | "outbound-dial";
    ApiVersion?: string | undefined;
    ForwardedFrom?: string | undefined;
    CallerName?: string | undefined;
    ParentCallSid?: string | undefined;
    ApplicationSid?: string | undefined;
    SessionId?: string | undefined;
    SessionStatus?: string | undefined;
    SessionDuration?: string | undefined;
    HandoffData?: string | undefined;
}, {
    AccountSid: string;
    CallSid: string;
    CallStatus: "queued" | "initiated" | "ringing" | "in-progress" | "completed" | "busy" | "no-answer" | "failed" | "canceled";
    From: string;
    To: string;
    Direction: "inbound" | "outbound-api" | "outbound-dial";
    ApiVersion?: string | undefined;
    ForwardedFrom?: string | undefined;
    CallerName?: string | undefined;
    ParentCallSid?: string | undefined;
    ApplicationSid?: string | undefined;
    SessionId?: string | undefined;
    SessionStatus?: string | undefined;
    SessionDuration?: string | undefined;
    HandoffData?: string | undefined;
}>;
type ConversationRelayCallbackPayload = z.infer<typeof ConversationRelayCallbackPayloadSchema>;
/**
 * Handoff data for Flex escalation
 */
declare const HandoffDataSchema: z.ZodObject<{
    reason: z.ZodString;
    call_summary: z.ZodString;
    sentiment: z.ZodString;
}, "strip", z.ZodTypeAny, {
    reason: string;
    call_summary: string;
    sentiment: string;
}, {
    reason: string;
    call_summary: string;
    sentiment: string;
}>;
type HandoffData = z.infer<typeof HandoffDataSchema>;

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
    description?: string | undefined;
    properties?: Record<string, any> | undefined;
    required?: string[] | undefined;
    items?: any;
    enum?: any[] | undefined;
}, {
    type: "string" | "number" | "boolean" | "object" | "array";
    description?: string | undefined;
    properties?: Record<string, any> | undefined;
    required?: string[] | undefined;
    items?: any;
    enum?: any[] | undefined;
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
            description?: string | undefined;
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
        }, {
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
        parameters: {
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
        };
    }, {
        name: string;
        description: string;
        parameters: {
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
        };
    }>;
}, "strip", z.ZodTypeAny, {
    function: {
        name: string;
        description: string;
        parameters: {
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
        };
    };
    type: "function";
}, {
    function: {
        name: string;
        description: string;
        parameters: {
            type: "string" | "number" | "boolean" | "object" | "array";
            description?: string | undefined;
            properties?: Record<string, any> | undefined;
            required?: string[] | undefined;
            items?: any;
            enum?: any[] | undefined;
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
 * Built-in tool types
 */
declare const BuiltInTools: {
    readonly RETRIEVE_MEMORY: "retrieve_profile_memory";
    readonly SEND_MESSAGE: "send_message";
    readonly ESCALATE_TO_HUMAN: "escalate_to_human";
    readonly SEARCH_KNOWLEDGE: "search_knowledge";
};
type BuiltInToolName = (typeof BuiltInTools)[keyof typeof BuiltInTools];

/**
 * Conversation Intelligence Types
 *
 * These types represent the webhook payloads and configuration for
 * processing Conversation Intelligence operator results.
 */
/**
 * Participant in operator execution (e.g., CUSTOMER, AGENT)
 */
declare const CintelParticipantSchema: z.ZodObject<{
    type: z.ZodString;
    profileId: z.ZodOptional<z.ZodString>;
    mediaParticipantId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: string;
    profileId?: string | undefined;
    mediaParticipantId?: string | undefined;
}, {
    type: string;
    profileId?: string | undefined;
    mediaParticipantId?: string | undefined;
}>;
type CintelParticipant = z.infer<typeof CintelParticipantSchema>;
/**
 * Execution details for an operator result
 */
declare const ExecutionDetailsSchema: z.ZodObject<{
    participants: z.ZodOptional<z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        profileId: z.ZodOptional<z.ZodString>;
        mediaParticipantId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        profileId?: string | undefined;
        mediaParticipantId?: string | undefined;
    }, {
        type: string;
        profileId?: string | undefined;
        mediaParticipantId?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    participants?: {
        type: string;
        profileId?: string | undefined;
        mediaParticipantId?: string | undefined;
    }[] | undefined;
}, {
    participants?: {
        type: string;
        profileId?: string | undefined;
        mediaParticipantId?: string | undefined;
    }[] | undefined;
}>;
type ExecutionDetails = z.infer<typeof ExecutionDetailsSchema>;
/**
 * Operator metadata
 */
declare const OperatorSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name?: string | undefined;
}, {
    id: string;
    name?: string | undefined;
}>;
type Operator = z.infer<typeof OperatorSchema>;
/**
 * Individual operator result from Conversation Intelligence
 */
declare const OperatorResultSchema: z.ZodObject<{
    id: z.ZodString;
    operator: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name?: string | undefined;
    }, {
        id: string;
        name?: string | undefined;
    }>;
    outputFormat: z.ZodString;
    result: z.ZodUnknown;
    dateCreated: z.ZodString;
    referenceIds: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    executionDetails: z.ZodOptional<z.ZodObject<{
        participants: z.ZodOptional<z.ZodArray<z.ZodObject<{
            type: z.ZodString;
            profileId: z.ZodOptional<z.ZodString>;
            mediaParticipantId: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: string;
            profileId?: string | undefined;
            mediaParticipantId?: string | undefined;
        }, {
            type: string;
            profileId?: string | undefined;
            mediaParticipantId?: string | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        participants?: {
            type: string;
            profileId?: string | undefined;
            mediaParticipantId?: string | undefined;
        }[] | undefined;
    }, {
        participants?: {
            type: string;
            profileId?: string | undefined;
            mediaParticipantId?: string | undefined;
        }[] | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    operator: {
        id: string;
        name?: string | undefined;
    };
    outputFormat: string;
    dateCreated: string;
    referenceIds: string[];
    result?: unknown;
    executionDetails?: {
        participants?: {
            type: string;
            profileId?: string | undefined;
            mediaParticipantId?: string | undefined;
        }[] | undefined;
    } | undefined;
}, {
    id: string;
    operator: {
        id: string;
        name?: string | undefined;
    };
    outputFormat: string;
    dateCreated: string;
    result?: unknown;
    referenceIds?: string[] | undefined;
    executionDetails?: {
        participants?: {
            type: string;
            profileId?: string | undefined;
            mediaParticipantId?: string | undefined;
        }[] | undefined;
    } | undefined;
}>;
type OperatorResult = z.infer<typeof OperatorResultSchema>;
/**
 * Intelligence configuration metadata
 */
declare const IntelligenceConfigurationSchema: z.ZodObject<{
    id: z.ZodString;
    friendlyName: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    friendlyName?: string | undefined;
}, {
    id: string;
    friendlyName?: string | undefined;
}>;
type IntelligenceConfiguration = z.infer<typeof IntelligenceConfigurationSchema>;
/**
 * Full webhook payload for operator result events
 */
declare const OperatorResultEventSchema: z.ZodObject<{
    accountId: z.ZodString;
    conversationId: z.ZodString;
    memoryStoreId: z.ZodOptional<z.ZodString>;
    intelligenceConfiguration: z.ZodObject<{
        id: z.ZodString;
        friendlyName: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        friendlyName?: string | undefined;
    }, {
        id: string;
        friendlyName?: string | undefined;
    }>;
    operatorResults: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        operator: z.ZodObject<{
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            name?: string | undefined;
        }, {
            id: string;
            name?: string | undefined;
        }>;
        outputFormat: z.ZodString;
        result: z.ZodUnknown;
        dateCreated: z.ZodString;
        referenceIds: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        executionDetails: z.ZodOptional<z.ZodObject<{
            participants: z.ZodOptional<z.ZodArray<z.ZodObject<{
                type: z.ZodString;
                profileId: z.ZodOptional<z.ZodString>;
                mediaParticipantId: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: string;
                profileId?: string | undefined;
                mediaParticipantId?: string | undefined;
            }, {
                type: string;
                profileId?: string | undefined;
                mediaParticipantId?: string | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            participants?: {
                type: string;
                profileId?: string | undefined;
                mediaParticipantId?: string | undefined;
            }[] | undefined;
        }, {
            participants?: {
                type: string;
                profileId?: string | undefined;
                mediaParticipantId?: string | undefined;
            }[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        operator: {
            id: string;
            name?: string | undefined;
        };
        outputFormat: string;
        dateCreated: string;
        referenceIds: string[];
        result?: unknown;
        executionDetails?: {
            participants?: {
                type: string;
                profileId?: string | undefined;
                mediaParticipantId?: string | undefined;
            }[] | undefined;
        } | undefined;
    }, {
        id: string;
        operator: {
            id: string;
            name?: string | undefined;
        };
        outputFormat: string;
        dateCreated: string;
        result?: unknown;
        referenceIds?: string[] | undefined;
        executionDetails?: {
            participants?: {
                type: string;
                profileId?: string | undefined;
                mediaParticipantId?: string | undefined;
            }[] | undefined;
        } | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    conversationId: string;
    accountId: string;
    intelligenceConfiguration: {
        id: string;
        friendlyName?: string | undefined;
    };
    operatorResults: {
        id: string;
        operator: {
            id: string;
            name?: string | undefined;
        };
        outputFormat: string;
        dateCreated: string;
        referenceIds: string[];
        result?: unknown;
        executionDetails?: {
            participants?: {
                type: string;
                profileId?: string | undefined;
                mediaParticipantId?: string | undefined;
            }[] | undefined;
        } | undefined;
    }[];
    memoryStoreId?: string | undefined;
}, {
    conversationId: string;
    accountId: string;
    intelligenceConfiguration: {
        id: string;
        friendlyName?: string | undefined;
    };
    operatorResults: {
        id: string;
        operator: {
            id: string;
            name?: string | undefined;
        };
        outputFormat: string;
        dateCreated: string;
        result?: unknown;
        referenceIds?: string[] | undefined;
        executionDetails?: {
            participants?: {
                type: string;
                profileId?: string | undefined;
                mediaParticipantId?: string | undefined;
            }[] | undefined;
        } | undefined;
    }[];
    memoryStoreId?: string | undefined;
}>;
type OperatorResultEvent = z.infer<typeof OperatorResultEventSchema>;
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
 * Conversation Intelligence configuration for TAC
 */
declare const ConversationIntelligenceConfigSchema: z.ZodObject<{
    configurationId: z.ZodString;
    observationOperatorSid: z.ZodOptional<z.ZodString>;
    summaryOperatorSid: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    configurationId: string;
    observationOperatorSid?: string | undefined;
    summaryOperatorSid?: string | undefined;
}, {
    configurationId: string;
    observationOperatorSid?: string | undefined;
    summaryOperatorSid?: string | undefined;
}>;
type ConversationIntelligenceConfig = z.infer<typeof ConversationIntelligenceConfigSchema>;
/**
 * Summary item for batch creation
 */
declare const ConversationSummaryItemSchema: z.ZodObject<{
    content: z.ZodString;
    conversationId: z.ZodString;
    occurredAt: z.ZodString;
    source: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    content: string;
    occurredAt: string;
    conversationId: string;
    source?: string | undefined;
}, {
    content: string;
    occurredAt: string;
    conversationId: string;
    source?: string | undefined;
}>;
type ConversationSummaryItem = z.infer<typeof ConversationSummaryItemSchema>;

/**
 * Channel type for communications
 */
declare const TACChannelTypeSchema: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
type TACChannelType = z.infer<typeof TACChannelTypeSchema>;
/**
 * Delivery status for communications
 */
declare const TACDeliveryStatusSchema: z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>;
type TACDeliveryStatus = z.infer<typeof TACDeliveryStatusSchema>;
/**
 * Participant type
 */
declare const TACParticipantTypeSchema: z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]>;
type TACParticipantType = z.infer<typeof TACParticipantTypeSchema>;
/**
 * Unified author model with all fields from both Memory and Maestro APIs.
 *
 * Fields not available from a particular API will be undefined.
 */
declare const TACCommunicationAuthorSchema: z.ZodObject<{
    address: z.ZodString;
    channel: z.ZodEnum<["VOICE", "SMS", "RCS", "EMAIL", "WHATSAPP", "CHAT", "API", "SYSTEM"]>;
    participantId: z.ZodOptional<z.ZodString>;
    deliveryStatus: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]>>;
    profileId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    address: string;
    channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
    type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
    id?: string | undefined;
    name?: string | undefined;
    participantId?: string | undefined;
    deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    profileId?: string | undefined;
}, {
    address: string;
    channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
    type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
    id?: string | undefined;
    name?: string | undefined;
    participantId?: string | undefined;
    deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
    profileId?: string | undefined;
}>;
type TACCommunicationAuthor = z.infer<typeof TACCommunicationAuthorSchema>;
/**
 * Unified content model with all fields from both Memory and Maestro APIs.
 */
declare const TACCommunicationContentSchema: z.ZodObject<{
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
type TACCommunicationContent = z.infer<typeof TACCommunicationContentSchema>;
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
        participantId: z.ZodOptional<z.ZodString>;
        deliveryStatus: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        type: z.ZodOptional<z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]>>;
        profileId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        participantId?: string | undefined;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        profileId?: string | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        participantId?: string | undefined;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        profileId?: string | undefined;
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
        participantId: z.ZodOptional<z.ZodString>;
        deliveryStatus: z.ZodOptional<z.ZodEnum<["INITIATED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "FAILED"]>>;
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        type: z.ZodOptional<z.ZodEnum<["HUMAN_AGENT", "CUSTOMER", "AI_AGENT"]>>;
        profileId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        participantId?: string | undefined;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        profileId?: string | undefined;
    }, {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        participantId?: string | undefined;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        profileId?: string | undefined;
    }>, "many">>;
    channelId: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
    conversationId: z.ZodOptional<z.ZodString>;
    accountId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    author: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        participantId?: string | undefined;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        profileId?: string | undefined;
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
        participantId?: string | undefined;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        profileId?: string | undefined;
    }[];
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
    channelId?: string | undefined;
    conversationId?: string | undefined;
    accountId?: string | undefined;
}, {
    id: string;
    author: {
        address: string;
        channel: "VOICE" | "SMS" | "RCS" | "EMAIL" | "WHATSAPP" | "CHAT" | "API" | "SYSTEM";
        type?: "HUMAN_AGENT" | "CUSTOMER" | "AI_AGENT" | undefined;
        id?: string | undefined;
        name?: string | undefined;
        participantId?: string | undefined;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        profileId?: string | undefined;
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
        participantId?: string | undefined;
        deliveryStatus?: "INITIATED" | "IN_PROGRESS" | "DELIVERED" | "COMPLETED" | "FAILED" | undefined;
        profileId?: string | undefined;
    }[] | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
    channelId?: string | undefined;
    conversationId?: string | undefined;
    accountId?: string | undefined;
}>;
type TACCommunication = z.infer<typeof TACCommunicationSchema>;

/**
 * Knowledge base status enum
 */
declare const KnowledgeBaseStatusSchema: z.ZodEnum<["QUEUED", "PROVISIONING", "ACTIVE", "FAILED", "DELETING"]>;
type KnowledgeBaseStatus = z.infer<typeof KnowledgeBaseStatusSchema>;
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
    displayName: string;
    description: string;
    version: number;
}, {
    status: "FAILED" | "QUEUED" | "PROVISIONING" | "ACTIVE" | "DELETING";
    id: string;
    createdAt: string;
    updatedAt: string;
    displayName: string;
    description: string;
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
 * Search response wrapper
 */
declare const KnowledgeSearchResponseSchema: z.ZodObject<{
    chunks: z.ZodArray<z.ZodObject<{
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
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    chunks: {
        content: string;
        createdAt: string;
        knowledgeId: string;
        score?: number | undefined;
    }[];
}, {
    chunks: {
        content: string;
        createdAt: string;
        knowledgeId: string;
        score?: number | undefined;
    }[];
}>;
type KnowledgeSearchResponse = z.infer<typeof KnowledgeSearchResponseSchema>;

/**
 * Unified response wrapper for TAC.retrieveMemory().
 *
 * Provides a consistent interface for accessing memory data regardless of whether
 * Memory API is configured or falling back to Maestro Communications API.
 *
 * Memory configured:
 * - observations, summaries, communications all populated
 * - communications include Memory-specific fields (author id, name, type, profileId)
 *
 * Maestro fallback:
 * - observations and summaries are empty arrays
 * - communications include Maestro-specific fields (conversationId, accountId, etc.)
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
 *   twilioAccountSid: 'ACxxxx',
 *   // ...
 * });
 * ```
 */
declare class TACConfig {
    readonly twilioAccountSid: string;
    readonly twilioAuthToken: string;
    readonly twilioApiKey: string;
    readonly twilioApiToken: string;
    readonly twilioPhoneNumber: string;
    readonly memoryStoreId?: string;
    readonly traitGroups?: string[];
    readonly conversationServiceId: string;
    readonly voicePublicDomain?: string;
    readonly cintelConfigurationId?: string;
    readonly cintelObservationOperatorSid?: string;
    readonly cintelSummaryOperatorSid?: string;
    constructor(data: TACConfigData);
    /**
     * Create TACConfig from environment variables.
     *
     * Loads configuration from the following environment variables:
     * - TWILIO_ACCOUNT_SID: Twilio Account SID (required)
     * - TWILIO_AUTH_TOKEN: Twilio Auth Token (required)
     * - TWILIO_API_KEY: Twilio API Key (required)
     * - TWILIO_API_TOKEN: Twilio API Token (required)
     * - TWILIO_PHONE_NUMBER: Twilio Phone Number (required)
     * - MEMORY_STORE_ID: Memory Store ID (optional, for Twilio Memory)
     * - TRAIT_GROUPS: Comma-separated trait group names (optional, for profile fetching)
     * - CONVERSATION_SERVICE_ID: Twilio Conversation Configuration ID (required)
     * - VOICE_PUBLIC_DOMAIN: Public domain for voice webhooks (optional)
     *
     * @throws Error if required environment variables are not set or invalid
     *
     * @example
     * ```typescript
     * // Ensure env vars are set before calling (e.g. via dotenv, Docker, CI, etc.)
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
 * Create a Pino logger with configured settings
 *
 * @param options - Logger configuration options
 * @returns Configured Pino logger
 */
declare function createLogger(options?: {
    level?: string;
    pretty?: boolean;
    name?: string;
}): Logger;

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
     * Send a communication using the Conversation Orchestrator Send API
     *
     * @param conversationId - The conversation ID
     * @param request - Send communication request
     * @returns Promise containing communication response
     */
    sendCommunication(conversationId: string, request: SendCommunicationRequest): Promise<SendCommunicationResponse>;
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
     * Retrieve the details for a single configuration
     *
     * @param configurationId - The configuration ID to retrieve
     * @returns Promise containing configuration details
     */
    getConfiguration(configurationId: string): Promise<ConversationConfiguration>;
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
 * Messaging webhook event types from Twilio Conversations Service
 * Supports the v2 format for SMS and Chat channels
 */
interface MessagingWebhookPayload {
    eventType: string;
    timestamp?: string;
    data?: {
        id?: string;
        conversationId?: string;
        accountId?: string;
        serviceId?: string;
        status?: string;
        participantType?: string;
        profileId?: string;
        channelId?: string;
        author?: {
            address?: string;
            channel?: string;
            participantId?: string;
        };
        content?: {
            type?: string;
            text?: string;
        };
        recipients?: Array<{
            address?: string;
            channel?: string;
            participantId?: string;
            deliveryStatus?: string;
        }>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
/**
 * Messaging channel configuration options
 */
interface MessagingChannelConfig {
    /** Maximum number of idempotency tokens to track for deduplication (default: 10,000) */
    dedupCapacity?: number;
}
/**
 * Messaging channel event callbacks extending base callbacks
 */
interface MessagingChannelEvents extends BaseChannelEvents {
    onMessageReceived?: (data: {
        conversationId: ConversationId;
        profileId: ProfileId | undefined;
        message: string;
        author: string;
        userMemory: any;
    }) => void;
}
/**
 * Abstract Messaging Channel base class for SMS and Chat channels
 *
 * Provides shared webhook processing logic for messaging channels
 * (SMS and Chat) that use the Conversations Service webhooks.
 */
declare abstract class MessagingChannel extends BaseChannel {
    protected readonly messagingCallbacks: MessagingChannelEvents;
    private readonly processedTokens;
    private readonly maxTrackedTokens;
    constructor(tac: TAC, config?: MessagingChannelConfig);
    /**
     * Check if a webhook has already been processed, and if not, record the token immediately.
     * This is intentionally a single synchronous check-and-record to prevent race conditions
     * where a duplicate arrives while the first request is still awaiting async work.
     * Uses a sliding window with FIFO eviction at capacity.
     */
    private isDuplicateWebhook;
    /**
     * Abstract method to check if a message is from the bot itself
     * Subclasses implement channel-specific filtering (e.g., by phone number or agent address)
     */
    protected abstract isOwnMessage(authorAddress: string): boolean;
    /**
     * Register event callbacks (override for messaging-specific events)
     */
    on(event: string, callback: (...args: any[]) => void): void;
    /**
     * Check if this webhook event belongs to this channel.
     * Returns false if the event is clearly for a different channel type.
     */
    private isEventForThisChannel;
    /**
     * Process messaging channel webhook from Twilio Conversations Service
     */
    processWebhook(payload: unknown, idempotencyToken?: string): Promise<void>;
    /**
     * Handle conversation creation event
     */
    private handleConversationCreated;
    /**
     * Handle participant added event
     */
    private handleParticipantAdded;
    /**
     * Handle new communication event (incoming message)
     */
    private handleCommunicationCreated;
    /**
     * Handle conversation updated event
     */
    private handleConversationUpdated;
    /**
     * Extract conversation ID from webhook payload
     */
    protected extractConversationId(payload: unknown): ConversationId | null;
    /**
     * Extract profile ID from webhook payload
     */
    protected extractProfileId(payload: unknown): ProfileId | null;
    /**
     * Validate messaging channel webhook payload structure
     */
    protected validateWebhookPayload(payload: unknown): boolean;
}

/**
 * SMS Channel implementation for Twilio Conversations Service
 *
 * Handles SMS conversations through webhook events from Twilio.
 * Automatically retrieves user memory and manages conversation lifecycle.
 */
declare class SMSChannel extends MessagingChannel {
    get channelType(): ChannelType;
    /**
     * Check if a message is from the bot itself (by phone number)
     */
    protected isOwnMessage(authorAddress: string): boolean;
    /**
     * Send SMS response using Conversation Orchestrator Send API
     */
    sendResponse(conversationId: ConversationId, message: string, metadata?: Record<string, unknown>): Promise<void>;
}

/**
 * Chat channel configuration options
 */
interface ChatChannelConfig extends MessagingChannelConfig {
    /** Chat agent identity string (defaults to 'ai-assistant') */
    agentAddress?: string;
}
/**
 * Chat Channel implementation for Twilio Conversations Service
 *
 * Handles web chat conversations through webhook events from Twilio.
 * Uses identity-based addressing instead of phone numbers.
 * Automatically creates AI_AGENT participant if needed and manages conversation lifecycle.
 */
declare class ChatChannel extends MessagingChannel {
    private readonly agentAddress;
    constructor(tac: TAC, config?: ChatChannelConfig);
    get channelType(): ChannelType;
    /**
     * Check if a message is from the bot itself (by agent address)
     */
    protected isOwnMessage(authorAddress: string): boolean;
    /**
     * Send chat response using Conversation Orchestrator Send API
     */
    sendResponse(conversationId: ConversationId, message: string, metadata?: Record<string, unknown>): Promise<void>;
}

/**
 * Voice channel event callbacks extending base callbacks
 */
interface VoiceChannelEvents extends BaseChannelEvents {
    onSetup?: (data: {
        callSid: string;
        from: string;
        to: string;
        customParameters: CustomParameters | undefined;
    }) => void;
    onPrompt?: (data: {
        conversationId: ConversationId;
        transcript: string;
        userMemory?: TACMemoryResponse;
        session?: ConversationSession;
    }) => void;
    onInterrupt?: (data: {
        conversationId: ConversationId;
        reason: string;
        transcript: string | undefined;
    }) => void;
    onWebSocketConnected?: (data: {
        conversationId: ConversationId;
    }) => void;
    onWebSocketDisconnected?: (data: {
        conversationId: ConversationId;
    }) => void;
}
/**
 * Voice Channel implementation for Twilio ConversationRelay
 *
 * Handles voice conversations through WebSocket connections.
 * Manages real-time audio streaming and conversation state.
 */
declare class VoiceChannel extends BaseChannel {
    private readonly webSocketConnections;
    private readonly voiceCallbacks;
    private readonly streamTasks;
    private readonly promptQueues;
    private readonly initializationRetries;
    private readonly MAX_INITIALIZATION_RETRIES;
    constructor(tac: TAC);
    get channelType(): ChannelType;
    /**
     * Register event callbacks (override for Voice-specific events)
     */
    on(event: string, callback: (...args: any[]) => void): void;
    /**
     * Process webhook - Voice channel doesn't use traditional webhooks,
     * but this method is required by the base class
     */
    processWebhook(_payload: unknown): Promise<void>;
    /**
     * Get active WebSocket connection for a conversation
     */
    getWebsocket(conversationId: ConversationId): WebSocket | null;
    /**
     * Handle WebSocket connection from ConversationRelay
     */
    handleWebSocketConnection(ws: WebSocket): void;
    /**
     * Handle WebSocket prompt message (user speech)
     */
    private handlePromptMessage;
    /**
     * Handle WebSocket interrupt message
     */
    private handleInterruptMessage;
    /**
     * Handle WebSocket disconnection
     */
    private handleWebSocketDisconnect;
    /**
     * Send voice response via WebSocket
     */
    sendResponse(conversationId: ConversationId, message: string, metadata?: Record<string, unknown>): Promise<void>;
    /**
     * Handle incoming voice call - generate TwiML to connect to ConversationRelay
     *
     * ConversationRelay will create the conversation automatically. The conversation
     * will be initialized on the first prompt using the callSid.
     *
     * @param options - Options for handling the incoming call
     * @returns TwiML XML string with ConversationRelay configuration
     */
    handleIncomingCall(options: {
        actionUrl?: string;
        conversationRelayConfig: ConversationRelayConfig;
    }): string;
    /**
     * Handle ConversationRelay callback from Twilio
     *
     * @param payload - Callback payload from Twilio
     * @param handoffHandler - Optional handler for handoff requests
     * @returns Response with status, content, and content type
     */
    handleConversationRelayCallback(payload: ConversationRelayCallbackPayload, handoffHandler?: (payload: ConversationRelayCallbackPayload) => Promise<string>): Promise<{
        status: number;
        content: string;
        contentType: string;
    }>;
    /**
     * Close all conversations associated with a call
     */
    private closeConversationsForCall;
    /**
     * Start tracking a streaming task for a conversation
     *
     * @param conversationId - The conversation ID
     * @returns AbortController for the task
     */
    startStreamTask(conversationId: ConversationId): AbortController;
    /**
     * Cancel an active streaming task
     *
     * @param conversationId - The conversation ID
     * @returns true if a task was cancelled, false otherwise
     */
    cancelStreamTask(conversationId: ConversationId): boolean;
    /**
     * Complete a streaming task (remove from tracking)
     *
     * @param conversationId - The conversation ID
     */
    completeStreamTask(conversationId: ConversationId): void;
    /**
     * Check if a stream task is active
     *
     * @param conversationId - The conversation ID
     * @returns true if an active task exists
     */
    hasActiveStreamTask(conversationId: ConversationId): boolean;
    /**
     * Generate TwiML to connect a call to ConversationRelay.
     * Validates configuration with Zod before generating TwiML.
     *
     * @param config - ConversationRelay configuration (url, transcription, TTS, etc.)
     * @param options - Optional settings for the Connect verb (e.g., actionUrl)
     * @returns TwiML XML string
     * @throws {Error} if config validation fails
     */
    connectConversationRelay(config: ConversationRelayConfig, options?: {
        actionUrl?: string;
    }): string;
    /**
     * Filter out undefined values from configuration object.
     * Keeps null, false, 0, and empty strings as they are valid values.
     */
    private filterUnsetValues;
    /**
     * Extract conversation ID - Not applicable for Voice channel
     */
    protected extractConversationId(_payload: unknown): ConversationId | null;
    /**
     * Extract profile ID - Not applicable for Voice channel
     */
    protected extractProfileId(_payload: unknown): ProfileId | null;
    /**
     * Cleanup channel state on shutdown
     *
     * Note: WebSocket connections are managed by the server and closed there.
     * This method only cleans up internal channel state.
     */
    shutdown(): void;
}

/**
 * Result of Flex handoff logic
 */
interface FlexHandoffResult {
    success: boolean;
    status: number;
    content: string;
    contentType: string;
}
/**
 * Handle Flex handoff logic for Twilio webhook
 *
 * Generates TwiML to enqueue a call to a Twilio Flex workflow for human agent handoff.
 *
 * @param formData - Form data from webhook request containing HandoffData and CallStatus
 * @param flexWorkflowSid - Flex TaskRouter workflow SID (starts with WW)
 * @returns Result with status, content (TwiML or error), and content type
 */
declare function handleFlexHandoffLogic(formData: Record<string, string>, flexWorkflowSid: string | undefined): FlexHandoffResult;

/**
 * Processor for Conversation Intelligence operator result webhooks
 *
 * Processes operator results from CI and creates observations or summaries
 * in the Memory service based on the operator configuration.
 */
declare class OperatorResultProcessor {
    private readonly memoryClient;
    private readonly config;
    private readonly logger;
    constructor(memoryClient: MemoryClient, config: ConversationIntelligenceConfig, logger?: Logger);
    /**
     * Process an operator result event webhook payload
     *
     * @param payload - The raw webhook payload
     * @returns Processing result indicating success/failure and details
     */
    processEvent(payload: unknown): Promise<OperatorProcessingResult>;
    /**
     * Process an individual operator result
     */
    private processOperatorResult;
    /**
     * Process an observation operator result
     */
    private processObservationEvent;
    /**
     * Process a summary operator result
     */
    private processSummaryEvent;
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

/**
 * Server configuration options
 */
interface TACServerConfig {
    /** Fastify server options */
    fastify?: FastifyServerOptions;
    /** Voice server configuration */
    voice?: Partial<VoiceServerConfig>;
    /** Custom webhook paths */
    webhookPaths?: {
        messaging?: string;
        twiml?: string;
        ws?: string;
        conversationRelayCallback?: string;
        /** Path for Conversation Intelligence webhook (optional - only registered if provided) */
        cintel?: string;
    };
    /** ConversationRelay configuration (welcomeGreeting, transcription, TTS, interaction settings, etc.) */
    conversationRelayConfig?: Partial<Omit<ConversationRelayConfig, 'url'>>;
    /** Handler for voice handoff requests (returns TwiML string) */
    handoffHandler?: (payload: ConversationRelayCallbackPayload) => Promise<string>;
    /** Enable development features */
    development?: boolean;
    /** Enable Twilio webhook signature validation (default: true) */
    validateWebhooks?: boolean;
    /** Voice channel instance (alternative to registering on TAC) */
    voiceChannel?: VoiceChannel;
    /** Messaging channel instances — webhooks are fanned out to all (alternative to registering on TAC) */
    messagingChannels?: MessagingChannel[];
}
/**
 * Batteries-included Fastify server for TAC
 *
 * Provides out-of-the-box setup for SMS and Voice channels with
 * proper webhook handling, WebSocket support, and production-ready defaults.
 */
declare class TACServer {
    private readonly fastify;
    private readonly tac;
    private readonly config;
    /** All enabled messaging channels — webhooks are fanned out to each one */
    private readonly messagingChannels;
    /** Voice channel instance */
    private readonly voiceChannel;
    constructor(tac: TAC, config?: TACServerConfig);
    /**
     * Get the full URL for webhook validation
     * Handles X-Forwarded-* headers for proxy/ngrok scenarios
     */
    private getWebhookUrl;
    /**
     * Register global Twilio webhook signature validation hook
     */
    private registerWebhookValidation;
    /**
     * Setup routes
     */
    private setupRoutes;
    /**
     * Start the server
     */
    start(): Promise<void>;
    /**
     * Wait for all WebSocket connections to close
     */
    private waitForWebSocketsToClose;
    /**
     * Stop the server gracefully
     */
    stop(): Promise<void>;
}

export { type AuthorInfo, AuthorInfoSchema, BaseChannel, type BaseChannelEvents, type BuiltInToolName, BuiltInTools, type CaptureRule, CaptureRuleSchema, type ChannelSettings, ChannelSettingsSchema, type ChannelType, ChannelTypeSchema, ChatChannel, type ChatChannelConfig, type CintelParticipant, CintelParticipantSchema, type Communication, type CommunicationContent, CommunicationContentSchema, type CommunicationParticipant, CommunicationParticipantSchema, CommunicationSchema, type ConversationAddress, ConversationAddressSchema, ConversationClient, type ConversationConfiguration, ConversationConfigurationSchema, type ConversationEndedCallback, type ConversationGroupingType, ConversationGroupingTypeSchema, type ConversationId, type ConversationIntelligenceConfig, ConversationIntelligenceConfigSchema, type ConversationParticipant, ConversationParticipantSchema, type ConversationRelayAttributes, ConversationRelayAttributesSchema, type ConversationRelayCallbackPayload, ConversationRelayCallbackPayloadSchema, type ConversationRelayConfig, ConversationRelayConfigSchema, type ConversationResponse, ConversationResponseSchema, type ConversationSession, ConversationSessionSchema, type ConversationSummaryItem, ConversationSummaryItemSchema, type CreateConversationSummariesResponse, CreateConversationSummariesResponseSchema, type CreateObservationResponse, CreateObservationResponseSchema, type CustomParameters, CustomParametersSchema, EMPTY_MEMORY_RESPONSE, EnvironmentVariables, type ExecutionDetails, ExecutionDetailsSchema, type FlexHandoffResult, type HandoffCallback, type HandoffData, HandoffDataSchema, type IntelligenceConfiguration, IntelligenceConfigurationSchema, type InterruptCallback, type InterruptMessage, InterruptMessageSchema, type JSONSchema, JSONSchemaSchema, type KnowledgeBase, KnowledgeBaseSchema, type KnowledgeBaseStatus, KnowledgeBaseStatusSchema, type KnowledgeChunkResult, KnowledgeChunkResultSchema, KnowledgeClient, type KnowledgeSearchResponse, KnowledgeSearchResponseSchema, type LanguageAttributes, LanguageAttributesSchema, type Logger, type MemoryChannelType, MemoryChannelTypeSchema, MemoryClient, type MemoryCommunication, type MemoryCommunicationContent, MemoryCommunicationContentSchema, MemoryCommunicationSchema, type MemoryDeliveryStatus, MemoryDeliveryStatusSchema, type MemoryParticipant, MemoryParticipantSchema, type MemoryParticipantType, MemoryParticipantTypeSchema, type MemoryRetrievalRequest, MemoryRetrievalRequestSchema, type MemoryRetrievalResponse, MemoryRetrievalResponseSchema, type MessageDirection, MessageDirectionSchema, type MessageReadyCallback, MessagingChannel, type MessagingChannelConfig, type MessagingChannelEvents, type MessagingWebhookPayload, type ObservationInfo, ObservationInfoSchema, type OpenAITool, OpenAIToolSchema, type Operator, type OperatorProcessingResult, OperatorProcessingResultSchema, type OperatorResult, type OperatorResultEvent, OperatorResultEventSchema, OperatorResultProcessor, OperatorResultSchema, OperatorSchema, type ParticipantAddress, ParticipantAddressSchema, type ParticipantAddressType, ParticipantAddressTypeSchema, type ParticipantId, type Profile, type ProfileId, type ProfileLookupResponse, ProfileLookupResponseSchema, type ProfileResponse, ProfileResponseSchema, type PromptMessage, PromptMessageSchema, SMSChannel, type SendCommunicationParticipantAddress, SendCommunicationParticipantAddressSchema, type SendCommunicationRequest, SendCommunicationRequestSchema, type SendCommunicationResponse, SendCommunicationResponseSchema, type SessionInfo, SessionInfoSchema, type SessionMessage, SessionMessageSchema, type SetupMessage, SetupMessageSchema, type StatusCallback, StatusCallbackSchema, type StatusTimeouts, StatusTimeoutsSchema, type SummaryInfo, SummaryInfoSchema, TAC, type TACChannelType, TACChannelTypeSchema, type TACCommunication, type TACCommunicationAuthor, TACCommunicationAuthorSchema, type TACCommunicationContent, TACCommunicationContentSchema, TACCommunicationSchema, TACConfig, type TACConfigData, TACConfigSchema, type TACDeliveryStatus, TACDeliveryStatusSchema, TACMemoryResponse, type TACOptions, type TACParticipantType, TACParticipantTypeSchema, TACServer, type TACServerConfig, TACTool, type TextTokenMessage, TextTokenMessageSchema, type ToolContext, type ToolExecutionResult, ToolExecutionResultSchema, type ToolFunction, type Transcription, TranscriptionSchema, type TranscriptionWord, TranscriptionWordSchema, VoiceChannel, type VoiceChannelEvents, type VoiceServerConfig, VoiceServerConfigSchema, type WebSocketMessage, WebSocketMessageSchema, type _SDKDriftGuards, createHandoffTool, createHandoffTools, createKnowledgeSearchTool, createKnowledgeSearchToolAsync, createKnowledgeTools, createLogger, createMemoryRetrievalTool, createMemoryTools, createMessagingTools, createSendMessageTool, defineTool, handleFlexHandoffLogic, isConversationId, isParticipantId, isProfileId };

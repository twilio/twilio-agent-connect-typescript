/**
 * TAC Demo Dashboard - Real-time Event Streaming
 *
 * This dashboard demonstrates Server-Sent Events (SSE) for real-time updates.
 * Key concepts:
 * 1. EventSource API - Browser-native SSE client
 * 2. Event handling - Processing incoming events
 * 3. Dynamic UI updates - Updating conversation cards and activity log
 */

// =============================================================================
// State Management
// =============================================================================

let eventSource = null;
let conversations = new Map();

// DOM elements
const conversationsGrid = document.getElementById('conversationsGrid');
const activityLog = document.getElementById('activityLog');
const conversationCount = document.getElementById('conversationCount');
const connectionStatus = document.getElementById('connectionStatus');

// =============================================================================
// Initialization
// =============================================================================

function init() {
    connectEventSource();
}

// =============================================================================
// Server-Sent Events (SSE) Connection
// =============================================================================

/**
 * Establishes SSE connection to the server.
 * EventSource automatically handles reconnection on connection loss.
 */
function connectEventSource() {
    if (eventSource) {
        eventSource.close();
    }

    // Create SSE connection to /events endpoint
    eventSource = new EventSource('/events');

    eventSource.onopen = () => {
        updateConnectionStatus(true);
        console.log('SSE connection established');
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleEvent(data);
        } catch (error) {
            console.error('Failed to parse event data:', error);
        }
    };

    eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        updateConnectionStatus(false);
        // EventSource automatically handles reconnection - no manual retry needed
    };
}

function updateConnectionStatus(connected) {
    if (connected) {
        connectionStatus.textContent = 'Connected';
        connectionStatus.className = 'badge rounded-pill bg-success';
    } else {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.className = 'badge rounded-pill bg-danger';
    }
}

// =============================================================================
// Event Processing
// =============================================================================

/**
 * Main event handler - routes events to appropriate UI updates
 */
function handleEvent(event) {
    console.log('Received event:', event);

    // Update conversation card if conversation_id is present
    if (event.conversation_id) {
        updateConversationCard(event);
    }

    // Add to activity log
    appendToActivityLog(event);
}

// =============================================================================
// Conversation Cards Management
// =============================================================================

function updateConversationCard(event) {
    const convId = event.conversation_id;

    // Get or create conversation data
    if (!conversations.has(convId)) {
        conversations.set(convId, {
            conversation_id: convId,
            channel: event.channel || 'unknown',
            profile_id: event.profile_id,
            events: []
        });
        createConversationCard(convId);
    }

    // Update conversation data
    const conversation = conversations.get(convId);

    // Update channel if we have a better value
    if (event.channel && event.channel !== 'unknown') {
        conversation.channel = event.channel;
    }

    // Update profile_id if we get it
    if (event.profile_id && !conversation.profile_id) {
        conversation.profile_id = event.profile_id;
    }

    conversation.events.push(event);

    // Update card content
    updateCardContent(convId);
}

function createConversationCard(convId) {
    const conversation = conversations.get(convId);

    // Remove empty state if present
    const emptyState = conversationsGrid.querySelector('.text-center');
    if (emptyState) {
        conversationsGrid.innerHTML = '';
    }

    const card = document.createElement('div');
    card.className = `card conversation-card border-start-${conversation.channel}`;
    card.id = `card-${convId}`;

    // Insert new conversation at the top
    conversationsGrid.prepend(card);
    updateConversationCount();
}

function updateCardContent(convId) {
    const conversation = conversations.get(convId);
    const card = document.getElementById(`card-${convId}`);

    if (!card) return;

    // Update card border class based on channel
    card.className = `card conversation-card border-start-${conversation.channel}`;

    // Shorten conversation ID for display
    const shortId = convId.length > 15 ? '...' + convId.slice(-10) : convId;

    // Build profile information
    let profileInfo = '';
    if (conversation.profile_id) {
        const shortProfileId = conversation.profile_id.length > 10
            ? '...' + conversation.profile_id.slice(-8)
            : conversation.profile_id;
        profileInfo = `
            <div class="alert alert-light py-2 mb-3" style="font-size: 0.875rem;">
                <span class="text-muted">Profile:</span>
                <span class="font-monospace" title="${conversation.profile_id}">${shortProfileId}</span>
            </div>
        `;
    }

    // Build event list
    const eventListHtml = conversation.events.map(event => {
        let messagePreview = '';
        if (event.message && (event.event_type === 'user_message' || event.event_type === 'ai_response' || event.event_type === 'memory')) {
            const truncated = event.message.length > 50 ? escapeHtml(event.message.slice(0, 50)) + '...' : escapeHtml(event.message);
            messagePreview = `<div class="text-muted small mt-1">${truncated}</div>`;
        }

        const icon = getEventIcon(event.event_type);
        const badgeClass = getEventBadgeClass(event.event_type);

        return `
            <li class="list-group-item event-item ${event.event_type} py-2">
                <div class="d-flex align-items-start gap-2">
                    <span style="font-size: 1.2rem;">${icon}</span>
                    <div class="flex-grow-1">
                        <span class="badge ${badgeClass} text-uppercase" style="font-size: 0.65rem;">
                            ${getEventLabel(event.event_type)}
                        </span>
                        ${messagePreview}
                    </div>
                </div>
            </li>
        `;
    }).join('');

    card.innerHTML = `
        <div class="card-body">
            <div class="d-flex justify-content-between align-items-center mb-3">
                <div>
                    <span class="text-muted small">Conversation: </span>
                    <span class="font-monospace small text-muted" title="${convId}">${shortId}</span>
                </div>
                <span class="badge bg-${conversation.channel === 'sms' ? 'primary' : 'success'} text-uppercase">
                    ${conversation.channel}
                </span>
            </div>
            ${profileInfo}
            <ul class="list-group list-group-flush event-list">
                ${eventListHtml}
            </ul>
        </div>
    `;

    // Auto-scroll event list to bottom
    const eventList = card.querySelector('.event-list');
    if (eventList) {
        eventList.scrollTop = eventList.scrollHeight;
    }
}

// =============================================================================
// Activity Log Management
// =============================================================================

function appendToActivityLog(event) {
    // Remove empty state if present
    const emptyState = activityLog.querySelector('.text-center');
    if (emptyState) {
        activityLog.innerHTML = '';
    }

    const timestamp = formatTimestamp(event.timestamp);
    const channel = event.channel || 'system';

    const logEntry = document.createElement('div');
    logEntry.className = `card mb-2 border-start border-start-${channel}`;
    logEntry.innerHTML = `
        <div class="card-body py-2 px-3">
            <div class="d-flex align-items-center gap-2">
                <span class="font-monospace small text-muted">${timestamp}</span>
                <span class="badge bg-${channel === 'sms' ? 'primary' : channel === 'voice' ? 'success' : 'secondary'} text-uppercase" style="font-size: 0.65rem;">
                    ${channel}
                </span>
                <span class="small">${escapeHtml(event.message)}</span>
            </div>
        </div>
    `;

    activityLog.appendChild(logEntry);

    // Auto-scroll to bottom
    activityLog.scrollTop = activityLog.scrollHeight;
}

// =============================================================================
// Utility Functions
// =============================================================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTimestamp(timestamp) {
    try {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    } catch (error) {
        return timestamp;
    }
}

function getEventLabel(eventType) {
    const labels = {
        'user_message': 'User message',
        'memory': 'Memory retrieved',
        'ai_processing': 'AI processing',
        'ai_response': 'AI response',
        'handoff': 'Handoff to human',
        'error': 'Error occurred',
        'conversation_started': 'Started',
        'call_started': 'Call started',
        'websocket_connected': 'WebSocket connected',
        'call_setup': 'Call setup'
    };
    return labels[eventType] || eventType;
}

function getEventIcon(eventType) {
    const icons = {
        'user_message': '&#128100;',
        'memory': '&#129504;',
        'ai_processing': '&#9881;',
        'ai_response': '&#129302;',
        'handoff': '&#128101;',
        'error': '&#10060;',
        'conversation_started': '&#128172;',
        'call_started': '&#128222;',
        'websocket_connected': '&#128268;',
        'call_setup': '&#128222;'
    };
    return icons[eventType] || '&#128204;';
}

function getEventBadgeClass(eventType) {
    const classes = {
        'user_message': 'bg-info',
        'memory': 'bg-warning',
        'ai_processing': 'bg-secondary',
        'ai_response': 'bg-success',
        'handoff': 'bg-danger',
        'error': 'bg-danger',
        'conversation_started': 'bg-primary',
        'call_started': 'bg-success',
        'websocket_connected': 'bg-primary',
        'call_setup': 'bg-info'
    };
    return classes[eventType] || 'bg-secondary';
}

function updateConversationCount() {
    conversationCount.textContent = conversations.size;
}

// =============================================================================
// Initialize on page load
// =============================================================================

init();

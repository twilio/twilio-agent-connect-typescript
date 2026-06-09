from langflow.custom import Component
from langflow.inputs import StrInput, SecretStrInput
from langflow.template import Output
from langflow.field_typing import Tool


class TwilioLiveAgentHandoff(Component):
    display_name = "Twilio Live Agent Handoff"
    description = (
        "Trigger a Twilio Studio Flow to hand the messaging conversation off "
        "to a Flex agent. Builds the HandoffData envelope (conversationId + "
        "attributes) that the Studio Flow's send-to-flex widget consumes."
    )
    icon = "user-check"
    name = "TwilioLiveAgentHandoff"

    inputs = [
        StrInput(
            name="account_sid",
            display_name="Twilio Account SID",
            info="AC...",
            required=True,
        ),
        SecretStrInput(
            name="api_key_sid",
            display_name="Twilio API Key SID",
            info="SK... API Key SID.",
            required=True,
        ),
        SecretStrInput(
            name="api_key_secret",
            display_name="Twilio API Key Secret",
            required=True,
        ),
        StrInput(
            name="studio_flow_sid",
            display_name="Studio Flow SID",
            info="FW... — the handoff Studio Flow that routes to Flex.",
            required=True,
        ),
        StrInput(
            name="whatsapp_from",
            display_name="WhatsApp From",
            info="The business WhatsApp sender, e.g. 'whatsapp:+15551234567'.",
            required=True,
        ),
        StrInput(
            name="tool_name",
            display_name="Tool Name",
            value="liveAgentHandoff",
            info="Must match what the system prompt references.",
        ),
        StrInput(
            name="tool_description",
            display_name="Tool Description",
            value=(
                "Hand the conversation off to a human agent (Flex) via a Studio Flow. "
                "Use when: (1) the customer explicitly asks for a human; (2) the "
                "request is beyond your scope; (3) the customer is frustrated and the "
                "conversation is not progressing. Takes the customer's phone number, "
                "full name (from the Memora context), and the reason for the transfer. "
                "AFTER calling this tool, do NOT produce any further response — the "
                "human agent takes over from here."
            ),
        ),
    ]

    outputs = [Output(name="tool", display_name="Tool", method="build_tool")]

    def build_tool(self) -> Tool:
        import json
        import requests
        from base64 import b64encode
        from pydantic import BaseModel, Field
        from langchain_core.tools import StructuredTool

        account_sid = self.account_sid
        api_key_sid = self.api_key_sid
        api_key_secret = self.api_key_secret
        flow_sid = self.studio_flow_sid
        whatsapp_from = self.whatsapp_from

        # TAC's Langflow integration passes TAC's conversationId as the Langflow
        # session_id. We capture it once at component-build time so the
        # Studio Flow can read trigger.request.parameters.HandoffData.conversationId.
        captured_session_id = (
            getattr(self, "session_id", None)
            or getattr(getattr(self, "graph", None), "session_id", None)
            or getattr(self, "_session_id", None)
        )

        class HandoffInput(BaseModel):
            customer_phone: str = Field(
                description=(
                    "The customer's phone number in E.164 format (e.g. +15551234567). "
                    "A 'whatsapp:' prefix is handled automatically."
                )
            )
            customer_name: str = Field(
                description=(
                    "The customer's full name (from the Memora context). Appears in "
                    "the Flex agent's queue. e.g. 'Jordan Rivera'."
                )
            )
            reason: str = Field(
                description=(
                    "A short, factual reason for the transfer. e.g. 'Customer asked "
                    "for a discount outside the available options'. This text is passed "
                    "to the agent as queue context."
                )
            )

        def run(customer_phone: str, customer_name: str, reason: str) -> str:
            phone = customer_phone.replace("whatsapp:", "").strip()
            if not phone.startswith("+"):
                return f"Invalid phone number: {customer_phone}. Use E.164 format."
            if not captured_session_id:
                return (
                    "Error: could not obtain the conversationId for the current session. "
                    "Check that this flow is invoked by TAC (which passes "
                    "session_id = conversationId)."
                )

            customer_address = f"whatsapp:{phone}"
            auth = b64encode(f"{api_key_sid}:{api_key_secret}".encode()).decode()
            url = f"https://studio.twilio.com/v2/Flows/{flow_sid}/Executions"

            # `attributes` becomes the Flex task attributes via the Studio
            # Flow's `{{trigger.request.parameters.HandoffData.attributes | to_json}}`
            # template. Keep it a real JSON object (not a stringified one) so
            # the to_json filter serializes it correctly.
            attributes = {
                "name": customer_name,
                "customerName": customer_name,
                "customerAddress": customer_address,
                "customerPhone": phone,
                "channelType": "whatsapp",
                "channel": "whatsapp",
                "from": customer_address,
                "to": whatsapp_from,
                "direction": "inbound",
                "reason": reason,
                "conversationId": captured_session_id,
            }
            handoff_data = {
                "conversationId": captured_session_id,
                "attributes": attributes,
            }
            data = {
                "To": customer_address,
                "From": whatsapp_from,
                "Parameters": json.dumps({"HandoffData": handoff_data}),
            }
            try:
                resp = requests.post(
                    url,
                    headers={"Authorization": f"Basic {auth}"},
                    data=data,
                    timeout=15,
                )
            except requests.exceptions.RequestException as e:
                return f"Network error starting the handoff: {e}"

            if not resp.ok:
                return (
                    f"Twilio rejected the handoff. HTTP {resp.status_code}. "
                    f"Response: {resp.text}"
                )

            execution_sid = resp.json().get("sid")
            return (
                f"Handoff started (execution {execution_sid}, conversationId="
                f"{captured_session_id}, customer={customer_name}). Do NOT produce "
                f"any further response — the human agent takes over from here."
            )

        return StructuredTool.from_function(
            name=self.tool_name,
            description=self.tool_description,
            func=run,
            args_schema=HandoffInput,
        )

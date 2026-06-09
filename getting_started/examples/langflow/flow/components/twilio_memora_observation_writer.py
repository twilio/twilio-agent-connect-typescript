from langflow.custom import Component
from langflow.inputs import StrInput, SecretStrInput
from langflow.template import Output
from langflow.field_typing import Tool


class TwilioMemoraObservationWriter(Component):
    display_name = "Twilio Memora Observation Writer"
    description = (
        "Write a structured observation to a customer's Memora profile. "
        "Used to record key moments — a stated preference, a commitment, a "
        "resolved issue — that future interactions should remember."
    )
    icon = "save"
    name = "TwilioMemoraObservationWriter"

    inputs = [
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
            name="memory_store_id",
            display_name="Memora Store ID",
            info="mem_store_... — get it from your TWILIO_CONVERSATION_CONFIGURATION_ID via GET https://conversations.twilio.com/v2/Configurations/<id>",
            required=True,
        ),
        StrInput(
            name="source",
            display_name="Observation Source",
            value="tac-langflow-example",
            info="Free-form tag for the observation source. Helps filter in the Memora UI.",
        ),
        StrInput(
            name="tool_name",
            display_name="Tool Name",
            value="record_observation",
            info="Must match what the system prompt references.",
        ),
        StrInput(
            name="tool_description",
            display_name="Tool Description",
            value=(
                "Record an important observation about this customer to their "
                "long-term Memora profile — for example a stated preference, a "
                "commitment, or a resolved issue. Use after a meaningful moment so "
                "future conversations (even days later) remember it. Takes the "
                "customer's phone number and a single, factual, self-contained "
                "description."
            ),
        ),
    ]

    outputs = [Output(name="tool", display_name="Tool", method="build_tool")]

    def build_tool(self) -> Tool:
        import requests
        from base64 import b64encode
        from datetime import datetime, timezone
        from pydantic import BaseModel, Field
        from langchain_core.tools import StructuredTool

        api_key_sid = self.api_key_sid
        api_key_secret = self.api_key_secret
        store_id = self.memory_store_id
        source = self.source

        class WriteInput(BaseModel):
            customer_phone: str = Field(
                description=(
                    "The customer's phone number in E.164 format "
                    "(e.g. +15551234567). A 'whatsapp:' prefix is stripped automatically."
                )
            )
            observation: str = Field(
                description=(
                    "A single, factual, self-contained sentence describing what to "
                    "remember about this customer. e.g. 'Prefers to be contacted by "
                    "SMS in the evening' or 'Confirmed the address update to 123 Main St.'"
                )
            )

        def run(customer_phone: str, observation: str) -> str:
            phone = customer_phone.replace("whatsapp:", "").strip()
            if not phone.startswith("+"):
                return f"Invalid phone number: {customer_phone}. Use E.164 format."

            auth = b64encode(f"{api_key_sid}:{api_key_secret}".encode()).decode()
            headers = {
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/json",
            }
            base = f"https://memory.twilio.com/v1/Stores/{store_id}"

            # 1. Lookup profile by phone identity
            try:
                resp = requests.post(
                    f"{base}/Profiles/Lookup",
                    headers=headers,
                    json={"idType": "phone", "value": phone},
                    timeout=15,
                )
            except requests.exceptions.RequestException as e:
                return f"Network error looking up the Memora profile: {e}"

            if not resp.ok:
                return (
                    f"Error looking up the Memora profile. HTTP {resp.status_code}. "
                    f"Response: {resp.text}"
                )

            profiles = resp.json().get("profiles", [])
            if not profiles:
                return (
                    f"No Memora profile found for {phone}. "
                    f"Observation not recorded — check that the customer has a profile."
                )

            # The SDK returns profiles as ['mem_profile_...', ...]; the REST
            # API has been seen returning either bare strings or objects with
            # an 'id' field depending on version. Handle both.
            first = profiles[0]
            profile_id = first if isinstance(first, str) else first.get("id")
            if not profile_id:
                return f"Memora profile found but its ID could not be extracted: {resp.text}"

            # 2. Create the observation
            now = datetime.now(timezone.utc)
            try:
                resp = requests.post(
                    f"{base}/Profiles/{profile_id}/Observations",
                    headers=headers,
                    json={
                        "observations": [
                            {
                                "content": observation,
                                "source": source,
                                "occurredAt": now.isoformat().replace("+00:00", "Z"),
                            }
                        ]
                    },
                    timeout=15,
                )
            except requests.exceptions.RequestException as e:
                return f"Network error writing the observation: {e}"

            if not resp.ok:
                return (
                    f"Error writing the observation to Memora. HTTP {resp.status_code}. "
                    f"Response: {resp.text}"
                )

            return (
                f"Observation recorded on profile {profile_id}. "
                f"Content: '{observation[:120]}{'…' if len(observation) > 120 else ''}'"
            )

        return StructuredTool.from_function(
            name=self.tool_name,
            description=self.tool_description,
            func=run,
            args_schema=WriteInput,
        )

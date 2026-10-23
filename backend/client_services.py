"""Service activation vocabulary. Sales stages remain unchanged."""
from pydantic import BaseModel, Field, field_validator

CLIENT_STATUSES = [
    "Not Started", "Onboarding", "DTCM Form Pending", "DTCM Form Completed",
    "Ready to Start", "Active", "Client is sending Infusion",
    "Started with Caregenix for RPM", "Started writing prescription",
    "On Hold", "Inactive",
]
GENERIC_STATUSES = ["Not Started", "Onboarding", "Active", "On Hold", "Inactive"]
DEFAULT_SERVICES = [
    {"id": "specialty-pharmacy-340b", "name": "Specialty pharmacy 340B",
     "statuses": GENERIC_STATUSES + ["Started writing prescription"]},
    {"id": "rpm", "name": "RPM",
     "statuses": GENERIC_STATUSES + ["Started with Caregenix for RPM"]},
    {"id": "infusion", "name": "Infusion",
     "statuses": GENERIC_STATUSES + ["Client is sending Infusion"]},
]
REFERRAL_STATUSES = ["Submitted", "Contacted", "Accepted", "In Progress", "Completed", "Declined"]
ORGANIZATION_TYPES = ["MSO", "RPM Provider", "Specialty Pharmacy", "Infusion Provider", "Physician Practice", "Other"]


class ServiceEnrollment(BaseModel):
    service_id: str = Field(min_length=1, max_length=80)
    status: str = Field(min_length=1, max_length=80)
    partner: str = Field(default="", max_length=160)


class ClientProfileInput(BaseModel):
    client_status: str
    services: list[ServiceEnrollment] = Field(default_factory=list, max_length=50)

    @field_validator("services")
    @classmethod
    def unique_services(cls, value):
        if len({s.service_id for s in value}) != len(value):
            raise ValueError("Each service can only be selected once")
        return value


class ServiceInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Enter a service name")
        return value


class ReferralInput(BaseModel):
    service_id: str = Field(min_length=1, max_length=80)
    destination: str = Field(min_length=2, max_length=160)
    reference: str = Field(min_length=1, max_length=100)
    status: str = "Submitted"

    @field_validator("destination", "reference")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("This field is required")
        return value.strip()


class ReferralStatusInput(BaseModel):
    status: str


class DemoInput(BaseModel):
    organization: str = Field(min_length=2, max_length=160)
    contact_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=254)
    organization_type: str
    services: list[str] = Field(min_length=1, max_length=10)
    consent: bool
    website: str = Field(default="", max_length=200)  # Honeypot.

    @field_validator("organization", "contact_name")
    @classmethod
    def trim_required(cls, value):
        value = value.strip()
        if len(value) < 2:
            raise ValueError("At least two characters are required")
        return value

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        import re
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid business email")
        return value

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from engine.providers.base import ProviderError, ProviderNotConfigured


class ApiError(Exception):
    def __init__(self, message: str, code: str = "bad_request", http_status: int = 400, details=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status
        self.details = details or {}


def error_body(code: str, message: str, details=None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def exception_handler(exc, context):
    if isinstance(exc, ProviderNotConfigured):
        return Response(error_body(exc.code, str(exc), {"provider": exc.provider}), status=status.HTTP_409_CONFLICT)
    if isinstance(exc, ProviderError):
        return Response(error_body(exc.code, str(exc), {"provider": exc.provider}), status=status.HTTP_502_BAD_GATEWAY)
    if isinstance(exc, ApiError):
        return Response(error_body(exc.code, exc.message, exc.details), status=exc.http_status)
    return drf_exception_handler(exc, context)

from django.conf import settings
from django.http import HttpResponse


class CorsMiddleware:
    """
    Minimal CORS middleware for local frontend/backend development.

    It handles browser preflight OPTIONS requests before they reach views with
    @require_POST / @require_GET decorators.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        origin = request.headers.get("Origin")

        if request.method == "OPTIONS" and self._is_allowed_origin(origin):
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)

        if self._is_allowed_origin(origin):
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Credentials"] = "true"
            response["Access-Control-Allow-Methods"] = ", ".join(
                getattr(settings, "CORS_ALLOWED_METHODS", ["GET", "POST", "OPTIONS"])
            )
            response["Access-Control-Allow-Headers"] = request.headers.get(
                "Access-Control-Request-Headers",
                ", ".join(
                    getattr(
                        settings,
                        "CORS_ALLOWED_HEADERS",
                        ["accept", "content-type", "authorization", "x-requested-with"],
                    )
                ),
            )
            response["Access-Control-Max-Age"] = "86400"
            response["Vary"] = "Origin"

        return response

    @staticmethod
    def _is_allowed_origin(origin):
        if not origin:
            return False

        allowed_origins = getattr(settings, "CORS_ALLOWED_ORIGINS", [])

        return origin in allowed_origins
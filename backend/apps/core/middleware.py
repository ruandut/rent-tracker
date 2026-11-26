class PermissionsPolicyMiddleware:
    """Turns off browser features the app never uses, so injected content can't ask for them."""

    POLICY = ", ".join(
        f"{feature}=()"
        for feature in (
            "accelerometer",
            "autoplay",
            "camera",
            "display-capture",
            "geolocation",
            "gyroscope",
            "magnetometer",
            "microphone",
            "midi",
            "payment",
            "publickey-credentials-get",
            "usb",
            "xr-spatial-tracking",
        )
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault("Permissions-Policy", self.POLICY)
        return response

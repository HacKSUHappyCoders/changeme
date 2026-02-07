from flask import Flask


def create_app():
    app = Flask(__name__, static_folder=None)

    from .routes import bp

    app.register_blueprint(bp)

    return app

import os

from fastapi import FastAPI
from psycopg import connect

app = FastAPI()


def _connection():
    return connect(os.environ["DATABASE_URL"])


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/tickets")
def list_tickets() -> list[dict[str, object]]:
    with _connection() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT id, title, status FROM tickets ORDER BY id")
        return [{"id": row[0], "title": row[1], "status": row[2]} for row in cursor.fetchall()]

using Npgsql;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var connectionString = Environment.GetEnvironmentVariable("DATABASE_URL");

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/tickets", async () =>
{
    await using var connection = new NpgsqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new NpgsqlCommand("SELECT id, title, status FROM tickets ORDER BY id", connection);
    await using var reader = await command.ExecuteReaderAsync();

    var tickets = new List<object>();
    while (await reader.ReadAsync())
    {
        tickets.Add(new { id = reader.GetString(0), title = reader.GetString(1), status = reader.GetString(2) });
    }

    return Results.Ok(tickets);
});

app.Run();

FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Set environment variable for port
ENV PORT=8000

# Run migrations and then start Gunicorn
CMD python manage.py migrate && python manage.py collectstatic --noinput --no-post-process && gunicorn backend.wsgi:application --bind 0.0.0.0:${PORT:-8000}
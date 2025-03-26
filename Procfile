web: gunicorn backend.wsgi --log-file -
worker: python manage.py runserver 0.0.0.0:$PORT
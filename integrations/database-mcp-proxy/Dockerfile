FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY database_mcp_proxy ./database_mcp_proxy
COPY run_http.py .

EXPOSE 9100

CMD ["python", "run_http.py"]

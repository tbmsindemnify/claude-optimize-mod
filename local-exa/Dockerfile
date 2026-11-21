FROM python:3.12-slim
ENV FASTEMBED_CACHE_PATH=/models
# The embedding model is downloaded into the image, so the server never fetches anything when it starts.
RUN pip install --no-cache-dir fastembed \
 && python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"
COPY server.py /server.py
CMD ["python", "-u", "/server.py"]

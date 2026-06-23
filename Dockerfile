FROM python:3.9-slim

# Create user with UID 1000 to match Hugging Face Space default
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

# Copy requirements and install
COPY --chown=user requirements.txt $HOME/app/requirements.txt
RUN pip install --no-cache-dir --user -r requirements.txt

# Copy all project files
COPY --chown=user . $HOME/app

# Port expected by Hugging Face Spaces
EXPOSE 7860
ENV PORT=7860

# Run Flask server
CMD ["python", "server.py"]

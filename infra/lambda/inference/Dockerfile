# Inference lambda image (Phase 4) — the repo's first Python/Docker lambda
# (xgboost/shap wheels don't fit a zip). Built ARM64 by CDK (T8); base image is
# multi-arch. Build context is the repo root so we can COPY the ml/ package.
#
#   docker build -f infra/lambda/inference/Dockerfile -t f1-inference .
FROM public.ecr.aws/lambda/python:3.12

# Install the f1pred package + its runtime deps (xgboost, shap, fastf1, pandas,
# pydantic, boto3). --no-cache-dir keeps the image lean (target < ~1 GB).
COPY ml/pyproject.toml ml/README.md ${LAMBDA_TASK_ROOT}/ml/
COPY ml/src ${LAMBDA_TASK_ROOT}/ml/src
RUN pip install --no-cache-dir "${LAMBDA_TASK_ROOT}/ml"

# FastF1 needs a writable HTTP cache; /tmp is the only writable dir at runtime.
ENV FASTF1_CACHE=/tmp/.fastf1-cache

# The thin adapter (imports handle_inference from f1pred).
COPY infra/lambda/inference/lambda_function.py ${LAMBDA_TASK_ROOT}/

CMD ["lambda_function.lambda_handler"]

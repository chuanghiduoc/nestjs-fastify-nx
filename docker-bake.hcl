variable "IMAGE_REGISTRY" {
  default = "ghcr.io"
}

variable "IMAGE_NAMESPACE" {
  default = "local"
}

variable "IMAGE_TAG" {
  default = "latest"
}

target "_production" {
  context    = "."
  dockerfile = "Dockerfile"
}

target "app" {
  inherits = ["_production"]
  target   = "app"
  tags     = ["${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/app:${IMAGE_TAG}"]
}

target "api" {
  inherits = ["_production"]
  target   = "api"
  tags     = ["${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/api:${IMAGE_TAG}"]
}

target "worker" {
  inherits = ["_production"]
  target   = "worker"
  tags     = ["${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/worker:${IMAGE_TAG}"]
}

target "scheduler" {
  inherits = ["_production"]
  target   = "scheduler"
  tags     = ["${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/scheduler:${IMAGE_TAG}"]
}

target "migration" {
  inherits = ["_production"]
  target   = "migration"
  tags     = ["${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/migration:${IMAGE_TAG}"]
}

group "production" {
  targets = ["app", "migration"]
}

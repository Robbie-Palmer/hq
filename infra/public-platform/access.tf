# These resources moved to infra/cloudflare-access. Drop the old state entries
# only after that root imports the live objects. destroy = false is the safety
# boundary that prevents the public-platform apply from touching Access.
removed {
  from = cloudflare_zero_trust_access_policy.preview_qa_agents

  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_zero_trust_access_application.pages_preview

  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_zero_trust_access_service_token.preview_qa_agents

  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_zero_trust_access_service_token.preview_qa_workflow

  lifecycle {
    destroy = false
  }
}

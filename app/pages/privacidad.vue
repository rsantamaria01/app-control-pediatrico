<template>
  <UContainer class="max-w-3xl space-y-6 py-8 pb-24">
    <h1 class="text-2xl font-semibold">
      Privacidad
    </h1>
    <UAlert
      color="warning"
      variant="soft"
      title="Borrador - pendiente de revisión legal"
      description="La política de privacidad aún no está disponible para publicación."
    />
    <UCard>
      <h2 class="text-lg font-semibold">
        Solicitudes sobre sus datos
      </h2>
      <p class="mt-2 text-sm text-muted">
        Borrador - pendiente de revisión legal. Si tiene una cuenta, puede registrar una solicitud para revisión desde su perfil.
      </p>
      <UButton
        to="/perfil/mis-datos"
        variant="outline"
        class="mt-4 min-h-11"
      >
        Ir a Mis datos
      </UButton>
    </UCard>
  </UContainer>
</template>

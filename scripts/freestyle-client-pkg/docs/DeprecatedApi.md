# freestyle_client.DeprecatedApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**handle_create_git_token**](DeprecatedApi.md#handle_create_git_token) | **POST** /git/v1/identity/{identity}/tokens | Create an access token for an identity
[**handle_create_identity**](DeprecatedApi.md#handle_create_identity) | **POST** /git/v1/identity | Create a Git identity
[**handle_delete_identity**](DeprecatedApi.md#handle_delete_identity) | **DELETE** /git/v1/identity/{identity} | Delete a Git identity
[**handle_deploy_web**](DeprecatedApi.md#handle_deploy_web) | **POST** /web/v1/deploy | Deploy a Website (v1)
[**handle_describe_permission**](DeprecatedApi.md#handle_describe_permission) | **GET** /git/v1/identity/{identity}/permissions/{repo} | Get the permission of an identity on a repository
[**handle_grant_permission**](DeprecatedApi.md#handle_grant_permission) | **POST** /git/v1/identity/{identity}/permissions/{repo} | Grant a permission to an identity
[**handle_list_git_tokens**](DeprecatedApi.md#handle_list_git_tokens) | **GET** /git/v1/identity/{identity}/tokens | List access tokens for an identity
[**handle_list_identities**](DeprecatedApi.md#handle_list_identities) | **GET** /git/v1/identity | List Git identities
[**handle_list_permissions**](DeprecatedApi.md#handle_list_permissions) | **GET** /git/v1/identity/{identity}/permissions | List repository permissions for an identity
[**handle_revoke_git_token**](DeprecatedApi.md#handle_revoke_git_token) | **DELETE** /git/v1/identity/{identity}/tokens | Revoke an access token for an identity
[**handle_revoke_permission**](DeprecatedApi.md#handle_revoke_permission) | **DELETE** /git/v1/identity/{identity}/permissions/{repo} | Revoke permissions from an identity
[**handle_update_permission**](DeprecatedApi.md#handle_update_permission) | **PATCH** /git/v1/identity/{identity}/permissions/{repo} | Update a permission for an identity


# **handle_create_git_token**
> CreatedToken handle_create_git_token(identity)

Create an access token for an identity

Create an access token for an identity.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.models.created_token import CreatedToken
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    identity = 'identity_example' # str | 

    try:
        # Create an access token for an identity
        api_response = api_instance.handle_create_git_token(identity)
        print("The response of DeprecatedApi->handle_create_git_token:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_create_git_token: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 

### Return type

[**CreatedToken**](CreatedToken.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Token created successfully |  -  |
**403** | Forbidden |  -  |
**404** | Identity not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_create_identity**
> FreestyleIdentity handle_create_identity()

Create a Git identity

Create a Git identity. This identity will be used to authenticate with Freestyle services.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.models.freestyle_identity import FreestyleIdentity
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)

    try:
        # Create a Git identity
        api_response = api_instance.handle_create_identity()
        print("The response of DeprecatedApi->handle_create_identity:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_create_identity: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**FreestyleIdentity**](FreestyleIdentity.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Identity created successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_delete_identity**
> object handle_delete_identity(identity)

Delete a Git identity

Delete a Git identity. This will revoke all permissions granted to this identity.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    identity = 'identity_example' # str | 

    try:
        # Delete a Git identity
        api_response = api_instance.handle_delete_identity(identity)
        print("The response of DeprecatedApi->handle_delete_identity:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_delete_identity: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Identity deleted |  -  |
**403** | Access denied |  -  |
**404** | Identity not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_deploy_web**
> FreestyleDeployWebSuccessResponseV2 handle_deploy_web(freestyle_deploy_web_payload)

Deploy a Website (v1)

Deploy a website. Files is a map of file paths to file contents. Configuration is optional and contains additional information about the deployment.

### Example


```python
import freestyle_client
from freestyle_client.models.freestyle_deploy_web_payload import FreestyleDeployWebPayload
from freestyle_client.models.freestyle_deploy_web_success_response_v2 import FreestyleDeployWebSuccessResponseV2
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    freestyle_deploy_web_payload = freestyle_client.FreestyleDeployWebPayload() # FreestyleDeployWebPayload | 

    try:
        # Deploy a Website (v1)
        api_response = api_instance.handle_deploy_web(freestyle_deploy_web_payload)
        print("The response of DeprecatedApi->handle_deploy_web:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_deploy_web: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **freestyle_deploy_web_payload** | [**FreestyleDeployWebPayload**](FreestyleDeployWebPayload.md)|  | 

### Return type

[**FreestyleDeployWebSuccessResponseV2**](FreestyleDeployWebSuccessResponseV2.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | successfully deployed |  -  |
**400** | failed to deploy |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_describe_permission**
> DescribeGitPermissionSuccess handle_describe_permission(identity, repo)

Get the permission of an identity on a repository

Get the permission of an identity on a repository. This will return the access level of the identity on the repository.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.models.describe_git_permission_success import DescribeGitPermissionSuccess
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    repo = 'repo_example' # str | The git repository ID

    try:
        # Get the permission of an identity on a repository
        api_response = api_instance.handle_describe_permission(identity, repo)
        print("The response of DeprecatedApi->handle_describe_permission:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_describe_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **repo** | **str**| The git repository ID | 

### Return type

[**DescribeGitPermissionSuccess**](DescribeGitPermissionSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Permission info |  -  |
**403** | Forbidden |  -  |
**404** | Not Found |  -  |
**500** | Internal Server Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_grant_permission**
> object handle_grant_permission(identity, repo, grant_git_permission_request)

Grant a permission to an identity

Grant a permission to an identity on a repository.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.models.grant_git_permission_request import GrantGitPermissionRequest
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    repo = 'repo_example' # str | The git repository ID
    grant_git_permission_request = freestyle_client.GrantGitPermissionRequest() # GrantGitPermissionRequest | 

    try:
        # Grant a permission to an identity
        api_response = api_instance.handle_grant_permission(identity, repo, grant_git_permission_request)
        print("The response of DeprecatedApi->handle_grant_permission:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_grant_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **repo** | **str**| The git repository ID | 
 **grant_git_permission_request** | [**GrantGitPermissionRequest**](GrantGitPermissionRequest.md)|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Permission granted successfully |  -  |
**403** | Forbidden |  -  |
**404** | Not Found |  -  |
**500** | Internal Server Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_git_tokens**
> ListGitTokensSuccess handle_list_git_tokens(identity)

List access tokens for an identity

List access tokens for an identity.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.models.list_git_tokens_success import ListGitTokensSuccess
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    identity = 'identity_example' # str | 

    try:
        # List access tokens for an identity
        api_response = api_instance.handle_list_git_tokens(identity)
        print("The response of DeprecatedApi->handle_list_git_tokens:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_list_git_tokens: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 

### Return type

[**ListGitTokensSuccess**](ListGitTokensSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Token list |  -  |
**403** | Forbidden |  -  |
**404** | Identity not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_identities**
> ListIdentitiesSuccess handle_list_identities(limit=limit, offset=offset, include_managed=include_managed)

List Git identities

List Git identities created by your account.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.models.list_identities_success import ListIdentitiesSuccess
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    limit = 56 # int |  (optional)
    offset = 56 # int |  (optional)
    include_managed = True # bool |  (optional)

    try:
        # List Git identities
        api_response = api_instance.handle_list_identities(limit=limit, offset=offset, include_managed=include_managed)
        print("The response of DeprecatedApi->handle_list_identities:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_list_identities: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**|  | [optional] 
 **offset** | **int**|  | [optional] 
 **include_managed** | **bool**|  | [optional] 

### Return type

[**ListIdentitiesSuccess**](ListIdentitiesSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of identities |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_permissions**
> ListGitPermissionSuccess handle_list_permissions(identity, limit=limit, offset=offset)

List repository permissions for an identity

List repository permissions for an identity. This will return a list of repositories that the identity has access to.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.models.list_git_permission_success import ListGitPermissionSuccess
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    identity = 'identity_example' # str | 
    limit = 56 # int | Maximum number of repositories to return (optional)
    offset = 56 # int | Offset for the list of repositories (optional)

    try:
        # List repository permissions for an identity
        api_response = api_instance.handle_list_permissions(identity, limit=limit, offset=offset)
        print("The response of DeprecatedApi->handle_list_permissions:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_list_permissions: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 
 **limit** | **int**| Maximum number of repositories to return | [optional] 
 **offset** | **int**| Offset for the list of repositories | [optional] 

### Return type

[**ListGitPermissionSuccess**](ListGitPermissionSuccess.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Permission list |  -  |
**403** | Forbidden |  -  |
**404** | Not Found |  -  |
**500** | Internal Server Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_revoke_git_token**
> object handle_revoke_git_token(identity, revoke_git_token_request)

Revoke an access token for an identity

Revoke an access token for an identity.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.models.revoke_git_token_request import RevokeGitTokenRequest
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    identity = 'identity_example' # str | 
    revoke_git_token_request = freestyle_client.RevokeGitTokenRequest() # RevokeGitTokenRequest | 

    try:
        # Revoke an access token for an identity
        api_response = api_instance.handle_revoke_git_token(identity, revoke_git_token_request)
        print("The response of DeprecatedApi->handle_revoke_git_token:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_revoke_git_token: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**|  | 
 **revoke_git_token_request** | [**RevokeGitTokenRequest**](RevokeGitTokenRequest.md)|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Token revoked |  -  |
**403** | Forbidden |  -  |
**404** | Identity not found |  -  |
**500** | Internal server error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_revoke_permission**
> object handle_revoke_permission(identity, repo)

Revoke permissions from an identity

Revoke a permission to an identity on a repository.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    repo = 'repo_example' # str | The git repository ID

    try:
        # Revoke permissions from an identity
        api_response = api_instance.handle_revoke_permission(identity, repo)
        print("The response of DeprecatedApi->handle_revoke_permission:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_revoke_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **repo** | **str**| The git repository ID | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Permission revoked successfully |  -  |
**403** | Forbidden |  -  |
**404** | Not Found |  -  |
**500** | Internal Server Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_update_permission**
> handle_update_permission(identity, repo, update_git_permission_request)

Update a permission for an identity

Update a permission for an identity on a repository.

**DEPRECATED:** Git identities have been promoted to global Freestyle identities used for provisioning resources scoped to customers. Please use the `/identity/v1/*` API instead.

### Example


```python
import freestyle_client
from freestyle_client.models.update_git_permission_request import UpdateGitPermissionRequest
from freestyle_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://api.freestyle.sh
# See configuration.py for a list of all supported configuration parameters.
configuration = freestyle_client.Configuration(
    host = "https://api.freestyle.sh"
)


# Enter a context with an instance of the API client
with freestyle_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = freestyle_client.DeprecatedApi(api_client)
    identity = 'identity_example' # str | The git identity ID
    repo = 'repo_example' # str | The git repository ID
    update_git_permission_request = freestyle_client.UpdateGitPermissionRequest() # UpdateGitPermissionRequest | 

    try:
        # Update a permission for an identity
        api_instance.handle_update_permission(identity, repo, update_git_permission_request)
    except Exception as e:
        print("Exception when calling DeprecatedApi->handle_update_permission: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **identity** | **str**| The git identity ID | 
 **repo** | **str**| The git repository ID | 
 **update_git_permission_request** | [**UpdateGitPermissionRequest**](UpdateGitPermissionRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined


[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)


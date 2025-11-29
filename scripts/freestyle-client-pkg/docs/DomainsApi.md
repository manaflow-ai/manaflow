# freestyle_client.DomainsApi

All URIs are relative to *https://api.freestyle.sh*

Method | HTTP request | Description
------------- | ------------- | -------------
[**handle_create_domain_verification**](DomainsApi.md#handle_create_domain_verification) | **POST** /domains/v1/verifications | Create a domain verification request
[**handle_delete_domain_mapping**](DomainsApi.md#handle_delete_domain_mapping) | **DELETE** /domains/v1/mappings/{domain} | Remove Domain Mapping
[**handle_delete_domain_verification**](DomainsApi.md#handle_delete_domain_verification) | **DELETE** /domains/v1/verifications | Delete a domain verification request
[**handle_insert_domain_mapping**](DomainsApi.md#handle_insert_domain_mapping) | **POST** /domains/v1/mappings/{domain} | Insert Domain Mapping
[**handle_list_domain_mappings**](DomainsApi.md#handle_list_domain_mappings) | **GET** /domains/v1/mappings | List Domain Mappings
[**handle_list_domain_verification_requests**](DomainsApi.md#handle_list_domain_verification_requests) | **GET** /domains/v1/verifications | List domain verification requests for an account
[**handle_list_domains**](DomainsApi.md#handle_list_domains) | **GET** /domains/v1/domains | List domains for an account
[**handle_verify_domain**](DomainsApi.md#handle_verify_domain) | **PUT** /domains/v1/verifications | Verify a domain verification request
[**handle_verify_wildcard**](DomainsApi.md#handle_verify_wildcard) | **POST** /domains/v1/certs/{domain}/wildcard | Provision a wildcard certificate


# **handle_create_domain_verification**
> DomainVerificationRequest handle_create_domain_verification(freestyle_domain_verification_request)

Create a domain verification request

This creates a Freestyle Domain Verification Request. It returns a `verificationCode` for your domain. You need to place this code in a TXT record at `_freestyle_custom_hostname.thedomain.com`, then call the [verify domain](/#tag/domains/PUT/domains/v1/verifications) endpoint with the domain to verify it.

### Example


```python
import freestyle_client
from freestyle_client.models.domain_verification_request import DomainVerificationRequest
from freestyle_client.models.freestyle_domain_verification_request import FreestyleDomainVerificationRequest
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
    api_instance = freestyle_client.DomainsApi(api_client)
    freestyle_domain_verification_request = freestyle_client.FreestyleDomainVerificationRequest() # FreestyleDomainVerificationRequest | 

    try:
        # Create a domain verification request
        api_response = api_instance.handle_create_domain_verification(freestyle_domain_verification_request)
        print("The response of DomainsApi->handle_create_domain_verification:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DomainsApi->handle_create_domain_verification: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **freestyle_domain_verification_request** | [**FreestyleDomainVerificationRequest**](FreestyleDomainVerificationRequest.md)|  | 

### Return type

[**DomainVerificationRequest**](DomainVerificationRequest.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Verification code created |  -  |
**400** | Failed to create verification code |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_delete_domain_mapping**
> object handle_delete_domain_mapping(domain)

Remove Domain Mapping

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
    api_instance = freestyle_client.DomainsApi(api_client)
    domain = 'domain_example' # str | 

    try:
        # Remove Domain Mapping
        api_response = api_instance.handle_delete_domain_mapping(domain)
        print("The response of DomainsApi->handle_delete_domain_mapping:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DomainsApi->handle_delete_domain_mapping: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **domain** | **str**|  | 

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
**200** | Successfully deleted domain mapping |  -  |
**400** | Error: DomainAlreadyExists |  -  |
**401** | Error: FailedPermissionsCheck |  -  |
**500** | Possible errors: FailedRemoveDomainMapping, FailedToInsertOwnership |  -  |
**502** | Error: FailedToCheckDomainMappingPermissions |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_delete_domain_verification**
> HandleDeleteDomainVerification200Response handle_delete_domain_verification(freestyle_delete_domain_verification_request)

Delete a domain verification request

This deletes a Freestyle Domain Verification Request. This does not remove the domain from the account if it has already been verified, however the verification code will no longer be valid.

### Example


```python
import freestyle_client
from freestyle_client.models.freestyle_delete_domain_verification_request import FreestyleDeleteDomainVerificationRequest
from freestyle_client.models.handle_delete_domain_verification200_response import HandleDeleteDomainVerification200Response
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
    api_instance = freestyle_client.DomainsApi(api_client)
    freestyle_delete_domain_verification_request = freestyle_client.FreestyleDeleteDomainVerificationRequest() # FreestyleDeleteDomainVerificationRequest | 

    try:
        # Delete a domain verification request
        api_response = api_instance.handle_delete_domain_verification(freestyle_delete_domain_verification_request)
        print("The response of DomainsApi->handle_delete_domain_verification:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DomainsApi->handle_delete_domain_verification: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **freestyle_delete_domain_verification_request** | [**FreestyleDeleteDomainVerificationRequest**](FreestyleDeleteDomainVerificationRequest.md)|  | 

### Return type

[**HandleDeleteDomainVerification200Response**](HandleDeleteDomainVerification200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Verification code created |  -  |
**400** | Failed to create verification code |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_insert_domain_mapping**
> FreestyleSandboxDomainMapping handle_insert_domain_mapping(domain, create_domain_mapping_request)

Insert Domain Mapping

This will unmap any other deployment to this domain

### Example


```python
import freestyle_client
from freestyle_client.models.create_domain_mapping_request import CreateDomainMappingRequest
from freestyle_client.models.freestyle_sandbox_domain_mapping import FreestyleSandboxDomainMapping
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
    api_instance = freestyle_client.DomainsApi(api_client)
    domain = 'domain_example' # str | 
    create_domain_mapping_request = freestyle_client.CreateDomainMappingRequest() # CreateDomainMappingRequest | 

    try:
        # Insert Domain Mapping
        api_response = api_instance.handle_insert_domain_mapping(domain, create_domain_mapping_request)
        print("The response of DomainsApi->handle_insert_domain_mapping:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DomainsApi->handle_insert_domain_mapping: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **domain** | **str**|  | 
 **create_domain_mapping_request** | [**CreateDomainMappingRequest**](CreateDomainMappingRequest.md)|  | 

### Return type

[**FreestyleSandboxDomainMapping**](FreestyleSandboxDomainMapping.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Successfully mapped domain to deployment |  -  |
**401** | You do not have permission to do this |  -  |
**422** | Failed to provision certificate |  -  |
**500** | Failed to insert ownership |  -  |
**502** | Failed to check permissions |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_domain_mappings**
> List[FreestyleSandboxDomainMapping] handle_list_domain_mappings(offset=offset, limit=limit, domain_ownership=domain_ownership, domain=domain)

List Domain Mappings

List domain mappings for any query based on exact domain or domain ownership (the domain ownership that gave the right to use the domain)

### Example


```python
import freestyle_client
from freestyle_client.models.freestyle_sandbox_domain_mapping import FreestyleSandboxDomainMapping
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
    api_instance = freestyle_client.DomainsApi(api_client)
    offset = 56 # int |  (optional)
    limit = 56 # int |  (optional)
    domain_ownership = 'domain_ownership_example' # str |  (optional)
    domain = 'domain_example' # str |  (optional)

    try:
        # List Domain Mappings
        api_response = api_instance.handle_list_domain_mappings(offset=offset, limit=limit, domain_ownership=domain_ownership, domain=domain)
        print("The response of DomainsApi->handle_list_domain_mappings:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DomainsApi->handle_list_domain_mappings: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **offset** | **int**|  | [optional] 
 **limit** | **int**|  | [optional] 
 **domain_ownership** | **str**|  | [optional] 
 **domain** | **str**|  | [optional] 

### Return type

[**List[FreestyleSandboxDomainMapping]**](FreestyleSandboxDomainMapping.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of domain mappings |  -  |
**401** | Unauthorized |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_domain_verification_requests**
> List[HandleListDomainVerificationRequests200ResponseInner] handle_list_domain_verification_requests()

List domain verification requests for an account

Lists domain verification requests for the current account.

### Example


```python
import freestyle_client
from freestyle_client.models.handle_list_domain_verification_requests200_response_inner import HandleListDomainVerificationRequests200ResponseInner
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
    api_instance = freestyle_client.DomainsApi(api_client)

    try:
        # List domain verification requests for an account
        api_response = api_instance.handle_list_domain_verification_requests()
        print("The response of DomainsApi->handle_list_domain_verification_requests:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DomainsApi->handle_list_domain_verification_requests: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**List[HandleListDomainVerificationRequests200ResponseInner]**](HandleListDomainVerificationRequests200ResponseInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of verification codes |  -  |
**400** | Failed to get verification codes |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_list_domains**
> List[HandleListDomains200ResponseInner] handle_list_domains(limit=limit, offset=offset, implicitly_owned=implicitly_owned)

List domains for an account

This lists the domains that an account has verified ownership of. This includes the *.style.dev domains the account has claimed.

### Example


```python
import freestyle_client
from freestyle_client.models.handle_list_domains200_response_inner import HandleListDomains200ResponseInner
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
    api_instance = freestyle_client.DomainsApi(api_client)
    limit = 56 # int |  (optional)
    offset = 56 # int |  (optional)
    implicitly_owned = True # bool |  (optional)

    try:
        # List domains for an account
        api_response = api_instance.handle_list_domains(limit=limit, offset=offset, implicitly_owned=implicitly_owned)
        print("The response of DomainsApi->handle_list_domains:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DomainsApi->handle_list_domains: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**|  | [optional] 
 **offset** | **int**|  | [optional] 
 **implicitly_owned** | **bool**|  | [optional] 

### Return type

[**List[HandleListDomains200ResponseInner]**](HandleListDomains200ResponseInner.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of domains |  -  |
**400** | Failed to get domains |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_verify_domain**
> HandleVerifyWildcard200Response handle_verify_domain(freestyle_verify_domain_request)

Verify a domain verification request

This checks a pre-existing verification request for a domain. To create a verification request, call the [create domain verification](/#tag/domains/POST/domains/v1/verifications) endpoint. This endpoint will check if the domain has a TXT record with the verification code. If it does, the domain will be verified.

### Example


```python
import freestyle_client
from freestyle_client.models.freestyle_verify_domain_request import FreestyleVerifyDomainRequest
from freestyle_client.models.handle_verify_wildcard200_response import HandleVerifyWildcard200Response
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
    api_instance = freestyle_client.DomainsApi(api_client)
    freestyle_verify_domain_request = freestyle_client.FreestyleVerifyDomainRequest() # FreestyleVerifyDomainRequest | 

    try:
        # Verify a domain verification request
        api_response = api_instance.handle_verify_domain(freestyle_verify_domain_request)
        print("The response of DomainsApi->handle_verify_domain:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DomainsApi->handle_verify_domain: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **freestyle_verify_domain_request** | [**FreestyleVerifyDomainRequest**](FreestyleVerifyDomainRequest.md)|  | 

### Return type

[**HandleVerifyWildcard200Response**](HandleVerifyWildcard200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Domain verified |  -  |
**400** | Failed to verify domain |  -  |
**404** | Domain verification request not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **handle_verify_wildcard**
> HandleVerifyWildcard200Response handle_verify_wildcard(domain)

Provision a wildcard certificate

Provisions a wildcard certificate for a verified domain


This speeds up deploys on all subdomains of the domain. In order to use it, you must add the following record to your DNS config:

`_acme-challenge.yourdomain.com` NS `dns.freestyle.sh`

### Example


```python
import freestyle_client
from freestyle_client.models.handle_verify_wildcard200_response import HandleVerifyWildcard200Response
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
    api_instance = freestyle_client.DomainsApi(api_client)
    domain = 'domain_example' # str | 

    try:
        # Provision a wildcard certificate
        api_response = api_instance.handle_verify_wildcard(domain)
        print("The response of DomainsApi->handle_verify_wildcard:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DomainsApi->handle_verify_wildcard: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **domain** | **str**|  | 

### Return type

[**HandleVerifyWildcard200Response**](HandleVerifyWildcard200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Domain verified |  -  |
**400** | Failed to preverify domain |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

